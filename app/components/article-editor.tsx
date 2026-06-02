"use client";

import { useState, useCallback, useRef, useEffect, MutableRefObject } from "react";
import ReactMarkdown from "react-markdown";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { createPortal } from "react-dom";

interface ArticleVersion {
  content: string;
  createdAt: string;
  wordCount: number;
}

interface ArticleEditorProps {
  content: string;
  isGenerating: boolean;
  isRefining?: boolean;
  isLoadingArticle?: boolean;
  hasOutline?: boolean;
  versions?: ArticleVersion[];
  currentVersionIndex?: number;
  onVersionSwitch?: (index: number) => void;
  refinedSectionIndex?: number | null;
  scrollRef?: MutableRefObject<{ scrollToTop: () => void; scrollToSection: (index: number) => void } | null>;
}

export function ArticleEditor({
  content,
  isGenerating,
  isRefining = false,
  isLoadingArticle = false,
  hasOutline = false,
  versions = [],
  currentVersionIndex = 0,
  onVersionSwitch,
  refinedSectionIndex,
  scrollRef,
}: ArticleEditorProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [showVersionDropdown, setShowVersionDropdown] = useState(false);
  const [fadeIn, setFadeIn] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Expose scroll methods via ref
  useEffect(() => {
    if (scrollRef) {
      scrollRef.current = {
        scrollToTop: () => {
          contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        },
        scrollToSection: (index: number) => {
          const headings = contentRef.current?.querySelectorAll('h2');
          if (headings && headings[index]) {
            headings[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        },
      };
    }
  }, [scrollRef]);

  // ESC to exit focus mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFocused) setIsFocused(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isFocused]);

  // Fade-in effect when loading article
  useEffect(() => {
    if (isLoadingArticle) {
      setFadeIn(false);
    } else {
      // Trigger fade-in after loading completes
      const timer = setTimeout(() => setFadeIn(true), 50);
      return () => clearTimeout(timer);
    }
  }, [isLoadingArticle]);

  // Auto-scroll to bottom while generating
  useEffect(() => {
    if (isGenerating && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [content, isGenerating]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [content]);

  if (!content && !isGenerating) {
    if (hasOutline) return null;
    return (
      <Card className="flex min-h-[600px] items-center justify-center">
        <div className="text-center px-8">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-800">
            <svg className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
            {t.readyToCreate}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm">
            {t.readyToCreateDesc}
          </p>
        </div>
      </Card>
    );
  }

  const versionLabel = versions.length > 0
    ? `v${currentVersionIndex + 1} · ${new Date(versions[currentVersionIndex]?.createdAt || '').toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
    : null;

  return (
    <>
    <Card className="relative min-h-[300px]">
      {/* Loading overlay for article loading */}
      {isLoadingArticle && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 dark:bg-gray-900/60 backdrop-blur-sm rounded-xl">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {t.loadArticle}...
          </div>
        </div>
      )}

      {/* Refining overlay */}
      {isRefining && (
        <div className="absolute inset-0 z-10 pointer-events-none rounded-xl overflow-hidden">
          <div className="absolute inset-0 bg-brand-50/30 dark:bg-brand-900/10 animate-pulse" />
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 px-5 py-3">
        <div className="flex items-center gap-3">
          {isGenerating && (
            <span className="flex items-center gap-2 text-sm text-brand-600">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand-500" />
              Writing...
            </span>
          )}
          {isRefining && (
            <span className="flex items-center gap-2 text-sm text-orange-600">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-orange-500" />
              {t.modifying}
            </span>
          )}
          {!isGenerating && !isRefining && content && (
            <span className="text-sm text-gray-500">
              {(() => {
                const chinese = (content.match(/[\u4e00-\u9fff]/g) || []).length;
                const english = content.replace(/[\u4e00-\u9fff]/g, '').split(/\s+/).filter(Boolean).length;
                return chinese + english;
              })()} {t.wordCount}
            </span>
          )}

          {/* Version indicator */}
          {versionLabel && versions.length > 1 && (
            <div className="relative">
              <button
                onClick={() => setShowVersionDropdown(!showVersionDropdown)}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand-700 bg-brand-50 hover:bg-brand-100 dark:text-brand-400 dark:bg-brand-900/30 dark:hover:bg-brand-900/50 transition-colors"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {versionLabel} · {versions.length} {t.versions}
                <svg className={cn("h-3 w-3 transition-transform", showVersionDropdown && "rotate-180")} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Version dropdown */}
              {showVersionDropdown && (
                <div className="absolute top-full left-0 mt-1 z-20 w-56 rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
                  <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">
                    <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t.versionHistory}</span>
                  </div>
                  <ul className="max-h-48 overflow-y-auto py-1">
                    {versions.map((v, i) => (
                      <li key={i}>
                        <button
                          onClick={() => {
                            onVersionSwitch?.(i);
                            setShowVersionDropdown(false);
                          }}
                          className={cn(
                            "w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors",
                            i === currentVersionIndex && "bg-brand-50 dark:bg-brand-900/20"
                          )}
                        >
                          <span className="flex items-center gap-2">
                            <span className={cn(
                              "font-medium",
                              i === currentVersionIndex ? "text-brand-700 dark:text-brand-400" : "text-gray-700 dark:text-gray-300"
                            )}>
                              v{i + 1}
                            </span>
                            <span className="text-gray-500 dark:text-gray-400">
                              {new Date(v.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </span>
                          <span className="text-gray-400">{v.wordCount} {t.characters}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right side: copy + expand */}
        <div className="flex items-center gap-2">
          {content && !isGenerating && (
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700/50 transition-colors"
              title={copied ? t.copied : t.copy}
            >
              {copied ? (
                <svg className="h-3.5 w-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
              {copied ? t.copied : t.copy}
            </button>
          )}
          {content && (
            <button
              onClick={() => setIsFocused(true)}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700/50 transition-colors"
              title={t.focusMode}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
              {t.focusMode}
            </button>
          )}
        </div>
      </div>

      {/* Content area */}
      <div
        ref={contentRef}
        data-article-content
        className="max-h-[60vh] overflow-y-auto px-8 py-6"
      >
        <div className={cn(
          "prose-editor transition-opacity duration-300",
          isLoadingArticle ? "opacity-0" : fadeIn ? "opacity-100" : "opacity-100"
        )}>
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
        {isGenerating && (
          <div className="mt-4 animate-shimmer h-4 rounded" />
        )}
      </div>
    </Card>

    {/* Focus mode overlay (portal) */}
    {isFocused && typeof document !== 'undefined' && createPortal(
      <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-gray-950 animate-in fade-in duration-200">
        {/* Focus mode toolbar */}
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 px-6 py-3 flex-shrink-0">
          <div className="flex items-center gap-3">
            {isGenerating && (
              <span className="flex items-center gap-2 text-sm text-brand-600">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand-500" />
                Writing...
              </span>
            )}
            {isRefining && (
              <span className="flex items-center gap-2 text-sm text-orange-600">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-orange-500" />
                {t.modifying}
              </span>
            )}
            {!isGenerating && !isRefining && content && (
              <span className="text-sm text-gray-400">
                {(() => {
                  const chinese = (content.match(/[\u4e00-\u9fff]/g) || []).length;
                  const english = content.replace(/[\u4e00-\u9fff]/g, '').split(/\s+/).filter(Boolean).length;
                  return chinese + english;
                })()} {t.wordCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {content && !isGenerating && (
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700/50 transition-colors"
              >
                {copied ? (
                  <svg className="h-3.5 w-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                )}
                {copied ? t.copied : t.copy}
              </button>
            )}
            <button
              onClick={() => setIsFocused(false)}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-gray-100 dark:hover:bg-gray-800 transition-colors border border-gray-200 dark:border-gray-700"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
              </svg>
              {t.exitFocusMode}
              <kbd className="ml-1 text-[10px] text-gray-400 dark:text-gray-500">Esc</kbd>
            </button>
          </div>
        </div>

        {/* Focus mode content */}
        <div
          data-article-content
          className="flex-1 overflow-y-auto w-full"
        >
          <div className="max-w-4xl mx-auto px-8 py-8">
            <div className="prose-editor">
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
            {isGenerating && (
              <div className="mt-4 animate-shimmer h-4 rounded" />
            )}
          </div>
        </div>
      </div>,
      document.body
    )}
  </>
  );
}
