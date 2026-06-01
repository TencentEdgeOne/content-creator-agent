"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface TopicFormProps {
  onGenerate: (params: { topic: string; keywords: string; style: string; length: string; mode: string }) => void;
  onStop: () => void;
  isGenerating: boolean;
  preferences?: {
    defaultStyle?: string;
    defaultLength?: string;
    recentKeywords?: string[];
    recentTopics?: string[];
  } | null;
}

export function TopicForm({ onGenerate, onStop, isGenerating, preferences }: TopicFormProps) {
  const { t } = useI18n();
  const [topic, setTopic] = useState("");
  const [keywords, setKeywords] = useState("");
  const [style, setStyle] = useState("informative");
  const [length, setLength] = useState("medium");
  const [mode, setMode] = useState<"deepagent" | "lite">("lite");

  // AI keyword suggestion
  const [suggestedKeywords, setSuggestedKeywords] = useState("");
  const [isLoadingKeywords, setIsLoadingKeywords] = useState(false);
  const lastSuggestedTopic = useRef("");

  useEffect(() => {
    if (preferences) {
      if (preferences.defaultStyle) setStyle(preferences.defaultStyle);
      if (preferences.defaultLength) setLength(preferences.defaultLength);
    }
  }, [preferences]);

  const handleTopicBlur = useCallback(() => {
    const trimmed = topic.trim();
    if (!trimmed || keywords.trim() || trimmed === lastSuggestedTopic.current) return;

    lastSuggestedTopic.current = trimmed;
    setIsLoadingKeywords(true);
    setSuggestedKeywords("");

    fetch('/suggest-keywords', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: trimmed }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.keywords) setSuggestedKeywords(data.keywords);
      })
      .catch(() => {})
      .finally(() => setIsLoadingKeywords(false));
  }, [topic, keywords]);

  const handleAcceptSuggestion = useCallback(() => {
    if (suggestedKeywords) {
      setKeywords(suggestedKeywords);
      setSuggestedKeywords("");
    }
  }, [suggestedKeywords]);

  const handleKeywordsChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setKeywords(e.target.value);
    if (e.target.value) setSuggestedKeywords("");
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) return;
    onGenerate({ topic, keywords, style, length, mode });
  };

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <svg className="h-4 w-4 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          {t.newArticle}
        </h2>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            id="topic"
            label={t.topic}
            placeholder={t.topicPlaceholder}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onBlur={handleTopicBlur}
            disabled={isGenerating}
          />

          <Input
            id="keywords"
            label={t.keywords}
            placeholder={isLoadingKeywords ? ((t as any).suggestingKeywords || '正在生成建议关键词...') : t.keywordsPlaceholder}
            value={keywords}
            onChange={handleKeywordsChange}
            disabled={isGenerating}
            suggestion={suggestedKeywords}
            suggestionHint={(t as any).keywordSuggestionHint}
            onAcceptSuggestion={handleAcceptSuggestion}
          />

          {isLoadingKeywords && (
            <div className="flex items-center gap-1.5 -mt-2">
              <div className="flex gap-0.5">
                <span className="h-1 w-1 rounded-full bg-brand-400 animate-bounce [animation-delay:0ms]" />
                <span className="h-1 w-1 rounded-full bg-brand-400 animate-bounce [animation-delay:150ms]" />
                <span className="h-1 w-1 rounded-full bg-brand-400 animate-bounce [animation-delay:300ms]" />
              </div>
              <span className="text-[10px] text-gray-400">{(t as any).suggestingKeywords}</span>
            </div>
          )}

          {preferences?.recentKeywords && preferences.recentKeywords.length > 0 && !keywords && !suggestedKeywords && (
            <div className="flex flex-wrap gap-1 -mt-2">
              {preferences.recentKeywords.slice(0, 6).map((kw: string, i: number) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setKeywords(prev => prev ? `${prev}, ${kw}` : kw)}
                  className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 hover:bg-brand-50 hover:text-brand-600 transition-colors dark:bg-gray-800 dark:text-gray-400"
                >
                  {kw}
                </button>
              ))}
            </div>
          )}

          <Select
            id="style"
            label={t.style}
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            disabled={isGenerating}
            options={[
              { value: "informative", label: t.styleOptions.informative },
              { value: "persuasive", label: t.styleOptions.persuasive },
              { value: "technical", label: t.styleOptions.technical },
              { value: "casual", label: t.styleOptions.casual },
            ]}
          />

          <Select
            id="length"
            label={t.length}
            value={length}
            onChange={(e) => setLength(e.target.value)}
            disabled={isGenerating}
            options={[
              { value: "short", label: t.lengthOptions.short },
              { value: "medium", label: t.lengthOptions.medium },
              { value: "long", label: t.lengthOptions.long },
            ]}
          />

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {(t as any).agentMode || '生成模式'}
            </label>
            <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 p-0.5">
              <button
                type="button"
                onClick={() => setMode("lite")}
                disabled={isGenerating}
                className={cn(
                  "flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                  mode === "lite"
                    ? "bg-brand-600 text-white shadow-sm"
                    : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
                )}
              >
                {(t as any).modeLite || '轻量'}
              </button>
              <button
                type="button"
                onClick={() => setMode("deepagent")}
                disabled={isGenerating}
                className={cn(
                  "flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                  mode === "deepagent"
                    ? "bg-brand-600 text-white shadow-sm"
                    : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
                )}
              >
                {(t as any).modeDeepAgent || 'DeepAgent'}
              </button>
            </div>
            <p className="text-[10px] text-gray-400 dark:text-gray-500">
              {mode === "lite"
                ? ((t as any).modeLiteDesc || '低 Token 消耗，快速生成')
                : ((t as any).modeDeepAgentDesc || '完整 Agent 框架，功能更丰富')}
            </p>
          </div>

          {isGenerating ? (
            <Button type="button" variant="secondary" className="w-full" onClick={onStop}>
              <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
              </svg>
              {t.stop}
            </Button>
          ) : (
            <Button type="submit" className="w-full" disabled={!topic.trim()}>
              <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              {t.generateOutline}
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
