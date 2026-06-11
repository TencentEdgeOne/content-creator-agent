/**
 * Articles CRUD — EdgeOne Makers Node Function
 * File path cloud-functions/articles/index.ts maps to POST /articles
 *
 * Handles article persistence via the cloud-function store message API.
 * Each article version is stored as one record; the latest record is the
 * "current version". This avoids the deprecated `clearMessages+appendMessage`
 * pattern (SOP H-163) and gives a free audit trail.
 *
 * Actions: list | save | addVersion | get | delete
 */
import { createLogger } from '../_logger';

const logger = createLogger('articles');

interface ArticleVersion {
    content: string;
    createdAt: string;
    wordCount: number;
}

interface ArticleData {
    id: string;
    title: string;
    keywords: string;
    style: string;
    createdAt: string;
    wordCount: number;
    versions: ArticleVersion[];
    currentVersion: number;
}

const MANIFEST_CONV = 'articles-manifest';

/**
 * Read the latest manifest record (single record; newest history wins).
 */
async function getManifest(store: any): Promise<string[]> {
    try {
        const messages = await store.getMessages({ conversationId: MANIFEST_CONV, limit: 1, order: 'desc' });
        if (messages.length > 0 && messages[0].content) {
            const data = typeof messages[0].content === 'string'
                ? JSON.parse(messages[0].content)
                : messages[0].content;
            return Array.isArray(data) ? data : [];
        }
    } catch {}
    return [];
}

/**
 * Persist a manifest snapshot by appending a new record. We never call
 * clearMessages — the latest record always represents the current state.
 */
async function saveManifest(store: any, ids: string[]) {
    await store.appendMessage({
        conversationId: MANIFEST_CONV,
        role: 'system',
        content: JSON.stringify(ids),
        metadata: { type: 'manifest', ts: new Date().toISOString() },
    });
}

/**
 * Read the latest version of an article.
 */
async function getArticleById(store: any, id: string): Promise<ArticleData | null> {
    try {
        const messages = await store.getMessages({ conversationId: `article-${id}`, limit: 1, order: 'desc' });
        if (messages.length > 0 && messages[0].content) {
            return typeof messages[0].content === 'string'
                ? JSON.parse(messages[0].content)
                : messages[0].content;
        }
    } catch {}
    return null;
}

/**
 * Append a new version record. Multi-record accumulation preserves history.
 * `articleData` should be the *new* full article state (with one more version
 * than what existed before).
 */
async function appendArticleVersion(store: any, articleData: ArticleData) {
    await store.appendMessage({
        conversationId: `article-${articleData.id}`,
        role: 'system',
        content: JSON.stringify(articleData),
        metadata: { type: 'article', id: articleData.id, version: articleData.versions.length - 1 },
    });
}

function computeWordCount(content: string): number {
    const chinese = (content.match(/[\u4e00-\u9fff]/g) || []).length;
    const english = content.replace(/[\u4e00-\u9fff]/g, '').split(/\s+/).filter(Boolean).length;
    return chinese + english;
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

    const { action } = body;

    if (!store) {
        return createResponse({
            error: 'BLOB_NOT_CONFIGURED',
            message: 'Store is not available. Deploy to EdgeOne Makers for automatic configuration.',
        }, 503);
    }

    try {
        switch (action) {
            case 'list': {
                const ids = await getManifest(store);
                const articles: ArticleData[] = [];
                for (const id of ids) {
                    const data = await getArticleById(store, id);
                    if (data) articles.push(data);
                }
                articles.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
                return createResponse({ articles });
            }

            case 'save': {
                const { article } = body;
                if (!article?.content) {
                    return createResponse({ error: 'Missing article data' }, 400);
                }
                const id = article.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                const wordCount = computeWordCount(article.content);
                const now = article.createdAt || new Date().toISOString();
                const articleData: ArticleData = {
                    id,
                    title: article.title || 'Untitled',
                    keywords: article.keywords || '',
                    style: article.style || '',
                    createdAt: now,
                    wordCount,
                    versions: [{ content: article.content, createdAt: now, wordCount }],
                    currentVersion: 0,
                };
                await appendArticleVersion(store, articleData);
                const ids = await getManifest(store);
                if (!ids.includes(id)) {
                    await saveManifest(store, [id, ...ids]);
                }
                logger.log('Saved article:', id, `(${wordCount} words)`);
                return createResponse({ success: true, id });
            }

            case 'addVersion': {
                const { id, content: newContent } = body;
                if (!id || !newContent) {
                    return createResponse({ error: 'Missing id or content' }, 400);
                }
                const existing = await getArticleById(store, id);
                if (!existing) {
                    return createResponse({ error: 'Article not found' }, 404);
                }
                const wordCount = computeWordCount(newContent);
                const now = new Date().toISOString();
                existing.versions.push({ content: newContent, createdAt: now, wordCount });
                existing.currentVersion = existing.versions.length - 1;
                existing.wordCount = wordCount;
                const firstLine = newContent.split('\n').find((l: string) => l.trim()) || 'Untitled';
                existing.title = firstLine.replace(/^#+\s*/, '').slice(0, 100);
                await appendArticleVersion(store, existing);
                logger.log('Added version:', id, `v${existing.versions.length} (${wordCount} words)`);
                return createResponse({ success: true, id, versionCount: existing.versions.length });
            }

            case 'get': {
                const { id } = body;
                if (!id) return createResponse({ error: 'Missing id' }, 400);
                const data = await getArticleById(store, id);
                if (!data) return createResponse({ error: 'Article not found' }, 404);
                return createResponse({ article: data });
            }

            case 'delete': {
                const { id } = body;
                if (!id) return createResponse({ error: 'Missing id' }, 400);
                try { await store.clearMessages({ conversationId: `article-${id}` }); } catch {}
                const ids = await getManifest(store);
                await saveManifest(store, ids.filter((i: string) => i !== id));
                logger.log('Deleted article:', id);
                return createResponse({ success: true });
            }

            default:
                return createResponse({ error: 'Unknown action' }, 400);
        }
    } catch (e: any) {
        const msg = e?.message || String(e);
        const isCredentialError =
            e?.code === 'CREDENTIAL_ERROR' ||
            msg.includes('credential') ||
            msg.includes('Invalid project') ||
            msg.includes('Memory storage operation failed');
        if (isCredentialError) {
            logger.error('Storage not configured:', msg);
            return createResponse({ error: 'BLOB_NOT_CONFIGURED' }, 503);
        }
        logger.error(msg);
        return createResponse({ error: msg }, 500);
    }
}
