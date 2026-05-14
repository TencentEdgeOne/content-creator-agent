'use client';

import { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface ArticleStatsProps {
  content: string;
}

interface Heading {
  level: number;
  text: string;
  id: string;
}

export function ArticleStats({ content }: ArticleStatsProps) {
  const { t } = useI18n();
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);

  // Compute stats
  const stats = useMemo(() => {
    if (!content) {
      return { charCount: 0, wordCount: 0, paragraphCount: 0, readingTime: 0, h1: 0, h2: 0, h3: 0 };
    }
    // Character count (includes Chinese characters)
    const charCount = content.length;

    // Word count: Chinese characters count as 1 word each, English words counted separately
    const chineseChars = (content.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
    const withoutChinese = content.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ');
    const englishWords = withoutChinese.split(/\s+/).filter((w) => w.length > 0).length;
    const wordCount = chineseChars + englishWords;

    // Paragraph count
    const paragraphCount = content.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length;

    // Reading time (Chinese: 400 chars/min, English: 200 words/min)
    const readingTime = Math.max(1, Math.ceil((chineseChars / 400) + (englishWords / 200)));

    // Heading counts
    const h1 = (content.match(/^# [^#]/gm) || []).length;
    const h2 = (content.match(/^## [^#]/gm) || []).length;
    const h3 = (content.match(/^### [^#]/gm) || []).length;

    return { charCount, wordCount, paragraphCount, readingTime, h1, h2, h3 };
  }, [content]);

  // Extract headings for outline
  const headings = useMemo<Heading[]>(() => {
    if (!content) return [];
    const result: Heading[] = [];
    const lines = content.split('\n');
    for (const line of lines) {
      const match = line.match(/^(#{1,3})\s+(.+)$/);
      if (match) {
        const level = match[1].length;
        const text = match[2].trim();
        const id = text
          .toLowerCase()
          .replace(/[^a-zA-Z0-9\u4e00-\u9fff\s-]/g, '')
          .replace(/\s+/g, '-')
          .slice(0, 80);
        result.push({ level, text, id });
      }
    }
    return result;
  }, [content]);

  // Scroll tracking for active heading
  useEffect(() => {
    const contentEl = document.querySelector('[data-article-content]');
    if (!contentEl) return;

    const handleScroll = () => {
      const headingEls = contentEl.querySelectorAll('h1, h2, h3');
      let currentId: string | null = null;

      for (const el of headingEls) {
        const rect = el.getBoundingClientRect();
        if (rect.top <= 200) {
          const text = el.textContent || '';
          const id = text
            .toLowerCase()
            .replace(/[^a-zA-Z0-9\u4e00-\u9fff\s-]/g, '')
            .replace(/\s+/g, '-')
            .slice(0, 80);
          currentId = id;
        }
      }
      setActiveHeadingId(currentId);
    };

    contentEl.addEventListener('scroll', handleScroll);
    return () => contentEl.removeEventListener('scroll', handleScroll);
  }, [content]);

  const scrollToHeading = useCallback((heading: Heading) => {
    const contentEl = document.querySelector('[data-article-content]');
    if (!contentEl) return;

    const headingEls = contentEl.querySelectorAll('h1, h2, h3');
    for (const el of headingEls) {
      const text = el.textContent || '';
      if (text.trim() === heading.text) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
      }
    }
  }, []);

  if (!content) {
    return (
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <svg className="h-4 w-4 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            {t.articleStats}
          </h2>
        </CardHeader>
        <CardContent>
          <div className="py-8 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800">
              <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t.statsEmpty || t.seoEmpty}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      {/* Stats Section */}
      <CardHeader>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <svg className="h-4 w-4 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          {t.articleStats}
        </h2>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-3">
          <StatRow label={t.wordCount} value={String(stats.wordCount)} />
          <StatRow label={t.characters} value={String(stats.charCount)} />
          <StatRow label={t.paragraphs} value={String(stats.paragraphCount)} />
          <StatRow label={t.readingTime} value={`${stats.readingTime} ${t.min}`} />
          <StatRow
            label={t.headings}
            value={`H1: ${stats.h1} | H2: ${stats.h2} | H3: ${stats.h3}`}
          />
        </div>

        {/* Outline Section */}
        {headings.length > 0 && (
          <div className="space-y-2 border-t border-gray-100 dark:border-gray-800 pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-2">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
              {t.outlineNav}
            </h3>
            <nav className="space-y-0.5 max-h-[300px] overflow-y-auto" aria-label={t.outlineNav}>
              {headings.map((heading, i) => (
                <button
                  key={`${heading.id}-${i}`}
                  onClick={() => scrollToHeading(heading)}
                  className={cn(
                    'block w-full text-left text-sm rounded-md px-2 py-1.5 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800',
                    heading.level === 1 && 'font-semibold text-gray-900 dark:text-gray-100',
                    heading.level === 2 && 'pl-4 text-gray-700 dark:text-gray-300',
                    heading.level === 3 && 'pl-8 text-gray-500 dark:text-gray-400 text-xs',
                    activeHeadingId === heading.id && 'bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-400'
                  )}
                >
                  {heading.text}
                </button>
              ))}
            </nav>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="font-medium text-gray-900 dark:text-gray-100">{value}</span>
    </div>
  );
}
