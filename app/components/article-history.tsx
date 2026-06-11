'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface ArticleVersion {
  content: string;
  createdAt: string;
  wordCount: number;
}

interface ArticleRecord {
  id: string;
  title: string;
  keywords: string;
  style: string;
  createdAt: string;
  wordCount: number;
  versions: ArticleVersion[];
  currentVersion: number;
}

interface ArticleHistoryProps {
  onLoadArticle: (id: string, content: string, keywords: string, versions: ArticleVersion[], versionIndex: number) => void;
  currentContent: string;
  currentKeywords: string;
  currentStyle: string;
  shouldAutoSave: boolean;
  onAutoSaved: (savedId: string, savedVersions: ArticleVersion[]) => void;
  currentArticleId: string | null;
  onSaveError?: (message: string) => void;
}

export function ArticleHistory({
  onLoadArticle,
  currentContent,
  currentKeywords,
  currentStyle,
  shouldAutoSave,
  onAutoSaved,
  currentArticleId,
  onSaveError,
}: ArticleHistoryProps) {
  const { t } = useI18n();
  const [articles, setArticles] = useState<ArticleRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savedToast, setSavedToast] = useState(false);
  const [blobError, setBlobError] = useState<string | null>(null);

  const fetchArticles = useCallback(async () => {
    try {
      const res = await fetch('/articles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list' }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error === 'BLOB_NOT_CONFIGURED') {
        setBlobError('BLOB_NOT_CONFIGURED');
        setArticles([]);
      } else {
        setBlobError(null);
        setArticles(data?.articles || []);
      }
    } catch {
      // silently fail
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchArticles();
  }, [fetchArticles]);

  // Auto-save: create new article or add version to existing
  useEffect(() => {
    if (!shouldAutoSave || !currentContent) return;

    const timer = setTimeout(() => {
      const autoSave = async () => {
        const firstLine = currentContent.split('\n').find((l) => l.trim()) || 'Untitled';
        const title = firstLine.replace(/^#+\s*/, '').slice(0, 100);

        try {
          if (currentArticleId) {
            const res = await fetch('/articles', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'addVersion', id: currentArticleId, content: currentContent }),
            });

            if (!res.ok) {
              const errData = await res.json().catch(() => null);
              if (errData?.error === 'BLOB_NOT_CONFIGURED') {
                setBlobError('BLOB_NOT_CONFIGURED');
              } else {
                onSaveError?.(errData?.message || `Save failed (${res.status})`);
              }
              onAutoSaved(currentArticleId, []);
              return;
            }

            const data = await res.json();
            if (data.error === 'BLOB_NOT_CONFIGURED') {
              setBlobError('BLOB_NOT_CONFIGURED');
              onAutoSaved(currentArticleId, []);
              return;
            }

            setSavedToast(true);
            setTimeout(() => setSavedToast(false), 2000);
            await fetchArticles();

            const articleRes = await fetch('/articles', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'get', id: currentArticleId }),
            });
            if (articleRes.ok) {
              const articleData = await articleRes.json();
              onAutoSaved(currentArticleId, articleData.article?.versions || []);
            } else {
              onAutoSaved(currentArticleId, []);
            }
          } else {
            const res = await fetch('/articles', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'save',
                article: { title, content: currentContent, keywords: currentKeywords, style: currentStyle, createdAt: new Date().toISOString() },
              }),
            });

            if (!res.ok) {
              const errData = await res.json().catch(() => null);
              if (errData?.error === 'BLOB_NOT_CONFIGURED') {
                setBlobError('BLOB_NOT_CONFIGURED');
              } else {
                onSaveError?.(errData?.message || `Save failed (${res.status})`);
              }
              onAutoSaved('', []);
              return;
            }

            const data = await res.json();
            if (data.error === 'BLOB_NOT_CONFIGURED') {
              setBlobError('BLOB_NOT_CONFIGURED');
              onAutoSaved('', []);
              return;
            }

            setSavedToast(true);
            setTimeout(() => setSavedToast(false), 2000);
            await fetchArticles();

            const chinese = (currentContent.match(/[\u4e00-\u9fff]/g) || []).length;
            const english = currentContent.replace(/[\u4e00-\u9fff]/g, '').split(/\s+/).filter(Boolean).length;
            const wordCount = chinese + english;
            onAutoSaved(data.id, [{ content: currentContent, createdAt: new Date().toISOString(), wordCount }]);
          }
        } catch (err) {
          console.error('Auto-save error:', err);
          onAutoSaved(currentArticleId || '', []);
        }
      };

      autoSave();
    }, 200);

    return () => clearTimeout(timer);
  }, [shouldAutoSave, currentContent, currentKeywords, currentStyle, onAutoSaved, fetchArticles, currentArticleId]);

  const handleDelete = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await fetch('/articles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'delete', id }),
        });
        setArticles((prev) => prev.filter((a) => a.id !== id));
      } catch {}
    },
    []
  );

  const handleLoad = useCallback(
    (article: ArticleRecord) => {
      const versionIndex = article.versions ? article.versions.length - 1 : 0;
      const latestContent = article.versions?.length
        ? article.versions[versionIndex].content
        : '';
      onLoadArticle(article.id, latestContent, article.keywords, article.versions || [], versionIndex);
    },
    [onLoadArticle]
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <svg className="h-4 w-4 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {t.history}
            {articles.length > 0 && (
              <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-brand-100 px-1.5 text-xs font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-400">
                {articles.length}
              </span>
            )}
          </h2>
        </div>
      </CardHeader>

      <CardContent>
        {savedToast && (
          <div className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700 dark:bg-green-900/20 dark:text-green-400">
            {t.autoSaved}
          </div>
        )}

        {isLoading ? (
          <div className="py-6 flex items-center justify-center gap-2">
            <svg className="h-4 w-4 animate-spin text-brand-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : blobError ? (
          <div className="py-4 px-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400">{t.blobNotConfigured}</p>
          </div>
        ) : articles.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">{t.noHistory}</p>
        ) : (
          <ul className="space-y-2 max-h-[300px] overflow-y-auto">
            {articles.map((article) => (
              <li
                key={article.id}
                className={cn(
                  "group cursor-pointer rounded-lg border p-3 transition-colors",
                  article.id === currentArticleId
                    ? "border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-brand-900/20"
                    : "border-gray-100 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/50"
                )}
                onClick={() => handleLoad(article)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleLoad(article)}
                aria-label={`${t.loadArticle}: ${article.title}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {article.title}
                    </p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                      <span>{new Date(article.createdAt).toLocaleDateString()}</span>
                      <span>&middot;</span>
                      <span>{article.wordCount} {t.characters}</span>
                      {article.versions && article.versions.length > 1 && (
                        <>
                          <span>&middot;</span>
                          <span className="text-brand-600 dark:text-brand-400">v{article.versions.length}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => handleDelete(article.id, e)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7 p-0 text-gray-400 hover:text-red-500"
                    aria-label={`${t.delete} ${article.title}`}
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
