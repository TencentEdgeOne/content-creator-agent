'use client';

import { useState, useCallback } from 'react';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface SeoData {
  score: number;
  keywordDensity: number;
  readabilityScore: number;
  headingStructure: { h1: number; h2: number; h3: number };
  suggestions: string[];
}

interface SeoPanelProps {
  content: string;
  keywords: string;
}

export function SeoPanel({ content, keywords }: SeoPanelProps) {
  const { t } = useI18n();
  const [seoData, setSeoData] = useState<SeoData | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const analyzeSeo = useCallback(() => {
    if (!content) return;
    setAnalyzing(true);

    setTimeout(() => {
      const keywordList = keywords.split(/[,，]/).map(k => k.trim()).filter(Boolean);

      // Keyword density
      let keywordCount = 0;
      const totalChars = content.length;
      for (const kw of keywordList) {
        const regex = new RegExp(kw, 'gi');
        keywordCount += (content.match(regex) || []).length;
      }
      const keywordDensity = totalChars > 0 ? Math.round((keywordCount / (totalChars / 100)) * 100) / 100 : 0;

      // Heading structure
      const h1 = (content.match(/^# [^#]/gm) || []).length;
      const h2 = (content.match(/^## [^#]/gm) || []).length;
      const h3 = (content.match(/^### [^#]/gm) || []).length;

      // Readability
      const sentences = content.split(/[。！？.!?]+/).filter(s => s.trim().length > 0);
      const avgSentenceLen = sentences.length > 0 ? Math.round(content.length / sentences.length) : 0;
      const readabilityScore = avgSentenceLen < 30 ? 90 : avgSentenceLen < 50 ? 75 : avgSentenceLen < 80 ? 60 : 45;

      // Suggestions
      const suggestions: string[] = [];
      const isZh = /[\u4e00-\u9fff]/.test(content);
      if (h2 < 3) suggestions.push(isZh ? '建议增加更多二级标题 (##) 来组织内容' : 'Add more H2 headings to structure content');
      if (keywordDensity < 1 && keywordList.length > 0) suggestions.push(isZh ? '关键词密度偏低，建议适当增加' : 'Keyword density is low');
      if (keywordDensity > 5) suggestions.push(isZh ? '关键词密度过高，可能被视为堆砌' : 'Keyword density too high');
      if (content.length < 500) suggestions.push(isZh ? '文章较短，建议扩展到 800+ 字' : 'Article is short, aim for 800+ words');
      if (suggestions.length === 0) suggestions.push(isZh ? '内容结构良好，SEO 表现优秀' : 'Content is well-structured for SEO');

      // Score
      let score = 50;
      if (h2 >= 3) score += 15;
      if (keywordDensity >= 1 && keywordDensity <= 4) score += 20;
      if (readabilityScore >= 70) score += 15;
      score = Math.min(100, score);

      setSeoData({ score, keywordDensity, readabilityScore, headingStructure: { h1, h2, h3 }, suggestions });
      setAnalyzing(false);
    }, 300);
  }, [content, keywords]);

  if (!content) {
    return (
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <svg className="h-4 w-4 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
            {t.seoPanel}
          </h2>
        </CardHeader>
        <CardContent>
          <div className="py-6 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">{t.seoPanelEmpty}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <svg className="h-4 w-4 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
            {t.seoPanel}
          </h2>
          {seoData && (
            <button
              onClick={() => { setSeoData(null); setTimeout(analyzeSeo, 50); }}
              className="p-1 rounded text-gray-400 hover:text-brand-500 hover:bg-brand-50 transition-colors"
              title="Refresh"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!seoData ? (
          <div className="py-3 text-center">
            <Button onClick={analyzeSeo} disabled={analyzing} size="sm" variant="secondary" className="text-xs">
              {analyzing ? t.seoAnalyzing : t.seoRunAnalysis}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Score bar */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">{t.seoScore}</span>
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-16 rounded-full bg-gray-200 dark:bg-gray-700">
                  <div
                    className={cn(
                      "h-1.5 rounded-full transition-all",
                      seoData.score >= 80 ? "bg-green-500" : seoData.score >= 60 ? "bg-yellow-500" : "bg-red-500"
                    )}
                    style={{ width: `${seoData.score}%` }}
                  />
                </div>
                <span className={cn(
                  "text-xs font-bold",
                  seoData.score >= 80 ? "text-green-600" : seoData.score >= 60 ? "text-yellow-600" : "text-red-600"
                )}>
                  {seoData.score}
                </span>
              </div>
            </div>

            {/* Metrics */}
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-500">{t.seoKeywordDensity}</span>
                <span className="font-medium">{seoData.keywordDensity}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{t.seoReadability}</span>
                <span className="font-medium">{seoData.readabilityScore}/100</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{t.seoHeadingStructure}</span>
                <span className="font-medium">H1:{seoData.headingStructure.h1} H2:{seoData.headingStructure.h2} H3:{seoData.headingStructure.h3}</span>
              </div>
            </div>

            {/* Suggestions */}
            <div className="border-t border-gray-100 dark:border-gray-800 pt-2">
              <h4 className="text-xs font-medium text-gray-500 mb-1.5">{t.seoSuggestions}</h4>
              <ul className="space-y-1">
                {seoData.suggestions.map((s, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                    <span className="text-brand-500 mt-0.5">•</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
