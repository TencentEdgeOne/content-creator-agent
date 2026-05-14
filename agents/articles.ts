import { getStore } from '@edgeone/pages-blob';

const logger = {
    log(...args: unknown[]) { console.log(`[articles][${new Date().toISOString()}]`, ...args); },
    error(...args: unknown[]) { console.error(`[articles][${new Date().toISOString()}]`, ...args); },
};

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

function getArticleStore() {
    const projectId = process.env.BLOB_PROJECT_ID;
    const token = process.env.BLOB_TOKEN;

    if (projectId && token) {
        return getStore({ name: 'articles', projectId, token });
    }
    return getStore('articles');
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

export async function onRequest(context: any) {
    const { request } = context;
    const body = request?.body ?? {};
    const { action } = body;

    try {
        const store = getArticleStore();

        switch (action) {
            case 'list': {
                const result = await store.list({ prefix: 'article-' });
                const articles: ArticleData[] = [];
                for (const item of (result as any).blobs || []) {
                    try {
                        const data = await store.get(item.key, { type: 'json' }) as ArticleData | null;
                        if (data) articles.push(data);
                    } catch {}
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
                await store.setJSON(`article-${id}`, articleData);
                logger.log('Saved article:', id, `(${wordCount} words)`);
                return createResponse({ success: true, id });
            }

            case 'addVersion': {
                const { id, content: newContent } = body;
                if (!id || !newContent) {
                    return createResponse({ error: 'Missing id or content' }, 400);
                }
                const existing = await store.get(`article-${id}`, { type: 'json' }) as ArticleData | null;
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
                await store.setJSON(`article-${id}`, existing);
                logger.log('Added version:', id, `v${existing.versions.length} (${wordCount} words)`);
                return createResponse({ success: true, id, versionCount: existing.versions.length });
            }

            case 'get': {
                const { id } = body;
                if (!id) return createResponse({ error: 'Missing id' }, 400);
                const data = await store.get(`article-${id}`, { type: 'json' }) as ArticleData | null;
                if (!data) return createResponse({ error: 'Article not found' }, 404);
                return createResponse({ article: data });
            }

            case 'delete': {
                const { id } = body;
                if (!id) return createResponse({ error: 'Missing id' }, 400);
                await store.delete(`article-${id}`);
                logger.log('Deleted article:', id);
                return createResponse({ success: true });
            }

            default:
                return createResponse({ error: 'Unknown action' }, 400);
        }
    } catch (e) {
        logger.error((e as Error).message);
        return createResponse({ error: (e as Error).message }, 500);
    }
}
