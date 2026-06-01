/**
 * User Preferences Agent (Long-term Memory)
 * Uses context.store for persistent preference storage across sessions.
 */
import { createLogger } from './_shared';

const logger = createLogger('preferences');

interface UserPreferences {
    userId: string;
    defaultStyle: string;
    defaultLength: string;
    defaultLanguage: string;
    recentKeywords: string[];
    recentTopics: string[];
    customInstructions: string;
    totalArticles: number;
    lastActiveAt: string;
}

function createDefaultPreferences(userId: string): UserPreferences {
    return {
        userId,
        defaultStyle: 'informative',
        defaultLength: 'medium',
        defaultLanguage: 'auto',
        recentKeywords: [],
        recentTopics: [],
        customInstructions: '',
        totalArticles: 0,
        lastActiveAt: new Date().toISOString(),
    };
}

function createResponse(data: any, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    });
}

export async function onRequest(context: any) {
    const { request, store } = context;
    const body = request?.body ?? {};
    const { action, userId = 'default' } = body;

    // context.store not available in local dev without Makers runtime
    if (!store) {
        const defaults = createDefaultPreferences(userId);
        if (action === 'get') return createResponse({ preferences: defaults });
        return createResponse({ success: true, preferences: defaults });
    }

    // One conversation per user acts as a "preferences namespace"
    const conversationId = `preferences-${userId}`;

    try {
        switch (action) {
            case 'get': {
                const messages = await store.getMessages({ conversationId, limit: 1, order: 'desc' });
                if (messages.length > 0 && messages[0].content) {
                    const prefs = typeof messages[0].content === 'string'
                        ? JSON.parse(messages[0].content)
                        : messages[0].content;
                    return createResponse({ preferences: prefs });
                }
                return createResponse({ preferences: createDefaultPreferences(userId) });
            }

            case 'save': {
                const { preferences } = body;
                if (!preferences) return createResponse({ error: 'Missing preferences' }, 400);

                const merged = {
                    ...createDefaultPreferences(userId),
                    ...preferences,
                    userId,
                    lastActiveAt: new Date().toISOString(),
                };
                try { await store.clearMessages({ conversationId }); } catch {}
                await store.appendMessage({
                    conversationId,
                    role: 'system',
                    content: JSON.stringify(merged),
                    metadata: { type: 'preferences', userId },
                });
                logger.log('Preferences saved for:', userId);
                return createResponse({ success: true });
            }

            case 'recordUsage': {
                const { topic, keywords, style, length } = body;
                let prefs = createDefaultPreferences(userId);

                // Load existing preferences
                try {
                    const messages = await store.getMessages({ conversationId, limit: 1, order: 'desc' });
                    if (messages.length > 0 && messages[0].content) {
                        prefs = typeof messages[0].content === 'string'
                            ? JSON.parse(messages[0].content)
                            : messages[0].content;
                    }
                } catch {}

                // Update
                if (topic) prefs.recentTopics = [topic, ...prefs.recentTopics.filter((t: string) => t !== topic)].slice(0, 10);
                if (keywords) {
                    const newKws = keywords.split(/[,，]/).map((k: string) => k.trim()).filter(Boolean);
                    prefs.recentKeywords = [...new Set([...newKws, ...prefs.recentKeywords])].slice(0, 20);
                }
                if (style) prefs.defaultStyle = style;
                if (length) prefs.defaultLength = length;
                prefs.totalArticles = (prefs.totalArticles || 0) + 1;
                prefs.lastActiveAt = new Date().toISOString();

                try { await store.clearMessages({ conversationId }); } catch {}
                await store.appendMessage({
                    conversationId,
                    role: 'system',
                    content: JSON.stringify(prefs),
                    metadata: { type: 'preferences', userId },
                });
                logger.log('Usage recorded:', userId, `(total: ${prefs.totalArticles})`);
                return createResponse({ success: true, preferences: prefs });
            }

            default:
                return createResponse({ error: 'Unknown action. Use: get, save, recordUsage' }, 400);
        }
    } catch (e) {
        logger.error((e as Error).message);
        return createResponse({ error: (e as Error).message }, 500);
    }
}
