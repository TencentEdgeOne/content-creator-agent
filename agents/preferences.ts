/**
 * User Preferences Agent (Long-term Memory)
 *
 * Implements persistent user memory using EdgeOne Pages' native memory system.
 * The memory API (context.memory) provides conversation-based storage with
 * LangGraph-compatible checkpointer and store backends.
 *
 * This agent uses a dedicated "preferences" conversation to persist user
 * writing preferences across sessions — functionally equivalent to deepagents'
 * Memory feature (StoreBackend + namespace isolation).
 *
 * Memory Pattern:
 * - Uses a fixed conversationId "user-preferences-{userId}" as the namespace
 * - Stores preferences as a system message in that conversation
 * - Reads latest preferences on load, updates after each generation
 */
import { getStore } from '@edgeone/pages-blob';

const logger = {
    log(...args: unknown[]) { console.log(`[preferences][${new Date().toISOString()}]`, ...args); },
    error(...args: unknown[]) { console.error(`[preferences][${new Date().toISOString()}]`, ...args); },
};

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

function getPreferenceStore() {
    const projectId = process.env.BLOB_PROJECT_ID;
    const token = process.env.BLOB_TOKEN;
    if (projectId && token) {
        return getStore({ name: 'preferences', projectId, token });
    }
    return getStore('preferences');
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
    const { request, memory } = context;
    const body = request?.body ?? {};
    const { action, userId = 'default' } = body;

    // Use Pages memory if available (native long-term memory)
    // Falls back to Blob storage for compatibility
    const useNativeMemory = !!memory;

    try {
        if (useNativeMemory) {
            // --- Pages Native Memory Implementation ---
            // Uses a fixed conversation as a "memory namespace" for preferences
            const conversationId = `preferences-${userId}`;

            switch (action) {
                case 'get': {
                    try {
                        const messages = await memory.getMessages({
                            conversationId,
                            limit: 1,
                            order: 'desc',
                        });
                        if (messages.length > 0 && messages[0].content) {
                            const prefs = typeof messages[0].content === 'string'
                                ? JSON.parse(messages[0].content)
                                : messages[0].content;
                            return createResponse({ preferences: prefs, source: 'memory' });
                        }
                    } catch {}
                    return createResponse({ preferences: createDefaultPreferences(userId), source: 'memory' });
                }

                case 'save': {
                    const { preferences } = body;
                    if (!preferences) return createResponse({ error: 'Missing preferences' }, 400);

                    const merged = { ...createDefaultPreferences(userId), ...preferences, userId, lastActiveAt: new Date().toISOString() };
                    // Clear old and write new (single-message pattern)
                    try { await memory.clearMessages({ conversationId }); } catch {}
                    await memory.appendMessage({
                        conversationId,
                        role: 'system',
                        content: JSON.stringify(merged),
                        metadata: { type: 'preferences', userId },
                    });
                    logger.log('Saved preferences via memory API for:', userId);
                    return createResponse({ success: true, source: 'memory' });
                }

                case 'recordUsage': {
                    const { topic, keywords, style, length } = body;
                    // Get existing
                    let prefs = createDefaultPreferences(userId);
                    try {
                        const messages = await memory.getMessages({ conversationId, limit: 1, order: 'desc' });
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

                    try { await memory.clearMessages({ conversationId }); } catch {}
                    await memory.appendMessage({
                        conversationId,
                        role: 'system',
                        content: JSON.stringify(prefs),
                        metadata: { type: 'preferences', userId },
                    });
                    logger.log('Recorded usage via memory API:', userId, `(total: ${prefs.totalArticles})`);
                    return createResponse({ success: true, preferences: prefs, source: 'memory' });
                }

                default:
                    return createResponse({ error: 'Unknown action. Use: get, save, recordUsage' }, 400);
            }
        } else {
            // --- Blob Storage Fallback ---
            const store = getPreferenceStore();
            const key = `pref-${userId}`;

            switch (action) {
                case 'get': {
                    const data = await store.get(key, { type: 'json' }) as UserPreferences | null;
                    return createResponse({ preferences: data || createDefaultPreferences(userId), source: 'blob' });
                }

                case 'save': {
                    const { preferences } = body;
                    if (!preferences) return createResponse({ error: 'Missing preferences' }, 400);
                    const existing = await store.get(key, { type: 'json' }) as UserPreferences | null;
                    const merged = { ...createDefaultPreferences(userId), ...existing, ...preferences, userId, lastActiveAt: new Date().toISOString() };
                    await store.setJSON(key, merged);
                    return createResponse({ success: true, source: 'blob' });
                }

                case 'recordUsage': {
                    const { topic, keywords, style, length } = body;
                    const existing = await store.get(key, { type: 'json' }) as UserPreferences | null;
                    const prefs = existing || createDefaultPreferences(userId);

                    if (topic) prefs.recentTopics = [topic, ...prefs.recentTopics.filter(t => t !== topic)].slice(0, 10);
                    if (keywords) {
                        const newKws = keywords.split(/[,，]/).map((k: string) => k.trim()).filter(Boolean);
                        prefs.recentKeywords = [...new Set([...newKws, ...prefs.recentKeywords])].slice(0, 20);
                    }
                    if (style) prefs.defaultStyle = style;
                    if (length) prefs.defaultLength = length;
                    prefs.totalArticles += 1;
                    prefs.lastActiveAt = new Date().toISOString();

                    await store.setJSON(key, prefs);
                    return createResponse({ success: true, preferences: prefs, source: 'blob' });
                }

                default:
                    return createResponse({ error: 'Unknown action. Use: get, save, recordUsage' }, 400);
            }
        }
    } catch (e) {
        logger.error((e as Error).message);
        return createResponse({ error: (e as Error).message }, 500);
    }
}
