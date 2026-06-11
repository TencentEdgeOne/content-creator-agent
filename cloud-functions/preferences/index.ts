/**
 * User Preferences — EdgeOne Makers Node Function
 * File path cloud-functions/preferences/index.ts maps to POST /preferences
 *
 * Persists per-user preferences via the cloud-function store message API.
 * Each save/recordUsage appends a new record; the latest record is the
 * "current" state. We never call `clearMessages` + `appendMessage` to
 * simulate a KV (SOP H-163 forbids it).
 *
 * Actions: get | save | recordUsage
 */
import { createLogger } from '../_logger';

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

export async function onRequestPost(context: any) {
    // SOP H-155: cloud-functions use context.agent.store (not context.store)
    const store = context.agent?.store ?? null;

    // SOP B-37: request body comes from context.request.body (pre-parsed by runtime)
    const body: Record<string, any> = context.request?.body ?? {};

    const { action, userId = 'default' } = body;

    if (!store) {
        const defaults = createDefaultPreferences(userId);
        if (action === 'get') return createResponse({ preferences: defaults });
        return createResponse({ success: true, preferences: defaults });
    }

    const conversationId = `preferences-${userId}`;

    /**
     * Read the most recent preferences record (latest write wins).
     */
    async function readLatestPrefs(): Promise<UserPreferences> {
        try {
            const messages = await store.getMessages({ conversationId, limit: 1, order: 'desc' });
            if (messages.length > 0 && messages[0].content) {
                const content = messages[0].content;
                return typeof content === 'string' ? JSON.parse(content) : content;
            }
        } catch {}
        return createDefaultPreferences(userId);
    }

    /**
     * Persist a new preferences record by appending. We keep history
     * (SOP H-165 "stored as multiple records via appendMessage").
     */
    async function writePrefs(prefs: UserPreferences) {
        await store.appendMessage({
            conversationId,
            role: 'system',
            content: JSON.stringify(prefs),
            metadata: { type: 'preferences', userId, ts: prefs.lastActiveAt },
        });
    }

    try {
        switch (action) {
            case 'get': {
                const prefs = await readLatestPrefs();
                return createResponse({ preferences: prefs });
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
                await writePrefs(merged);
                logger.log('Preferences saved for:', userId);
                return createResponse({ success: true });
            }

            case 'recordUsage': {
                const { topic, keywords, style, length } = body;
                const prefs = await readLatestPrefs();

                if (topic) prefs.recentTopics = [topic, ...prefs.recentTopics.filter((t: string) => t !== topic)].slice(0, 10);
                if (keywords) {
                    const newKws = keywords.split(/[,，]/).map((k: string) => k.trim()).filter(Boolean);
                    prefs.recentKeywords = [...new Set([...newKws, ...prefs.recentKeywords])].slice(0, 20);
                }
                if (style) prefs.defaultStyle = style;
                if (length) prefs.defaultLength = length;
                prefs.totalArticles = (prefs.totalArticles || 0) + 1;
                prefs.lastActiveAt = new Date().toISOString();

                await writePrefs(prefs);
                logger.log('Usage recorded:', userId, `(total: ${prefs.totalArticles})`);
                return createResponse({ success: true, preferences: prefs });
            }

            default:
                return createResponse({ error: 'Unknown action. Use: get, save, recordUsage' }, 400);
        }
    } catch (e: any) {
        const msg = e?.message || String(e);
        const isStorageError =
            e?.code === 'CREDENTIAL_ERROR' ||
            msg.includes('credential') ||
            msg.includes('Invalid project') ||
            msg.includes('Memory storage operation failed');
        if (isStorageError) {
            logger.error('Storage not configured:', msg);
            const defaults = createDefaultPreferences(userId);
            if (action === 'get') return createResponse({ error: 'BLOB_NOT_CONFIGURED', preferences: defaults });
            return createResponse({ error: 'BLOB_NOT_CONFIGURED', success: false });
        }
        logger.error(msg);
        return createResponse({ error: msg }, 500);
    }
}
