"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface OutlineSection {
  heading: string;
  keyPoints: string[];
  estimatedWords?: number;
}

interface Outline {
  title: string;
  summary: string;
  sections: OutlineSection[];
  estimatedTotalWords?: number;
  tone?: string;
}

interface OutlineCardProps {
  outline: Outline;
  onConfirm: (outline: any) => void;
  onRegenerate: () => void;
  onDismiss: () => void;
  isLoading?: boolean;
}

export function OutlineCard({
  outline,
  onConfirm,
  onRegenerate,
  onDismiss,
  isLoading = false,
}: OutlineCardProps) {
  const { t } = useI18n();
  const [editedOutline, setEditedOutline] = useState<Outline>(() =>
    JSON.parse(JSON.stringify(outline))
  );
  const [editingTitleIndex, setEditingTitleIndex] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);

  const updateSectionHeading = (idx: number, value: string) => {
    setEditedOutline((prev) => {
      const sections = [...prev.sections];
      sections[idx] = { ...sections[idx], heading: value };
      return { ...prev, sections };
    });
  };

  const updateKeyPoint = (sectionIdx: number, pointIdx: number, value: string) => {
    setEditedOutline((prev) => {
      const sections = [...prev.sections];
      const keyPoints = [...sections[sectionIdx].keyPoints];
      keyPoints[pointIdx] = value;
      sections[sectionIdx] = { ...sections[sectionIdx], keyPoints };
      return { ...prev, sections };
    });
  };

  const addKeyPoint = (sectionIdx: number) => {
    setEditedOutline((prev) => {
      const sections = [...prev.sections];
      sections[sectionIdx] = {
        ...sections[sectionIdx],
        keyPoints: [...sections[sectionIdx].keyPoints, ""],
      };
      return { ...prev, sections };
    });
  };

  const removeKeyPoint = (sectionIdx: number, pointIdx: number) => {
    setEditedOutline((prev) => {
      const sections = [...prev.sections];
      const keyPoints = sections[sectionIdx].keyPoints.filter((_, i) => i !== pointIdx);
      sections[sectionIdx] = { ...sections[sectionIdx], keyPoints };
      return { ...prev, sections };
    });
  };

  return (
    <div className="rounded-xl border border-brand-200 dark:border-brand-800 bg-white dark:bg-gray-900 shadow-sm overflow-hidden flex flex-col" style={{ maxHeight: 'calc(100vh - 120px)' }}>
      {/* Sticky top action bar */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-gray-100 dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm px-5 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <svg className="h-4 w-4 text-brand-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
            {(t as any).outlineReady ?? "大纲已生成，请确认或调整"}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors px-2 py-1"
            disabled={isLoading}
            onClick={onDismiss}
          >
            {(t as any).skipOutline ?? "跳过"}
          </button>
          <Button
            variant="secondary"
            size="sm"
            disabled={isLoading}
            onClick={onRegenerate}
          >
            <svg className="mr-1 h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {(t as any).regenerateOutline ?? "重新生成"}
          </Button>
          <Button
            size="sm"
            disabled={isLoading}
            onClick={() => onConfirm(editedOutline)}
          >
            <svg className="mr-1 h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            {(t as any).confirmOutline ?? "确认并开始写作"}
          </Button>
        </div>
      </div>

      {/* Scrollable outline content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* Article title */}
        {editingTitle ? (
          <input
            autoFocus
            className="w-full rounded-lg border border-brand-300 dark:border-brand-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-base font-semibold text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
            value={editedOutline.title}
            onChange={(e) => setEditedOutline((prev) => ({ ...prev, title: e.target.value }))}
            onBlur={() => setEditingTitle(false)}
            onKeyDown={(e) => e.key === "Enter" && setEditingTitle(false)}
          />
        ) : (
          <button
            className="group w-full text-left"
            onClick={() => setEditingTitle(true)}
          >
            <p className="text-base font-semibold text-gray-900 dark:text-gray-100 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
              {editedOutline.title}
              <span className="ml-2 opacity-0 group-hover:opacity-100 text-xs font-normal text-gray-400">✎</span>
            </p>
          </button>
        )}

        {/* Summary & tone */}
        <div className="flex items-start gap-2">
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed flex-1">
            {editedOutline.summary}
          </p>
          {editedOutline.tone && (
            <span className="shrink-0 rounded-full bg-brand-50 dark:bg-brand-900/30 px-2 py-0.5 text-xs text-brand-600 dark:text-brand-400 border border-brand-200 dark:border-brand-800">
              {editedOutline.tone}
            </span>
          )}
        </div>

        {/* Sections */}
        <ol className="space-y-3">
          {editedOutline.sections.map((section, si) => (
            <li key={si} className="rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 p-3 space-y-2">
              {editingTitleIndex === si ? (
                <input
                  autoFocus
                  className="w-full rounded border border-brand-300 dark:border-brand-700 bg-white dark:bg-gray-900 px-2 py-1 text-sm font-medium text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  value={section.heading}
                  onChange={(e) => updateSectionHeading(si, e.target.value)}
                  onBlur={() => setEditingTitleIndex(null)}
                  onKeyDown={(e) => e.key === "Enter" && setEditingTitleIndex(null)}
                />
              ) : (
                <button
                  className="group flex w-full items-start gap-2 text-left"
                  onClick={() => setEditingTitleIndex(si)}
                >
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 dark:bg-brand-900/50 text-xs font-semibold text-brand-600 dark:text-brand-400">
                    {si + 1}
                  </span>
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                    {section.heading}
                    <span className="ml-1.5 opacity-0 group-hover:opacity-100 text-xs font-normal text-gray-400">✎</span>
                  </span>
                </button>
              )}

              <ul className="ml-7 space-y-1">
                {section.keyPoints.map((point, pi) => (
                  <li key={pi} className="flex items-center gap-1.5">
                    <span className="shrink-0 h-1 w-1 rounded-full bg-brand-400 dark:bg-brand-500 mt-0.5" />
                    <input
                      className="flex-1 bg-transparent text-xs text-gray-600 dark:text-gray-400 focus:outline-none focus:text-gray-900 dark:focus:text-gray-100 placeholder:text-gray-300 dark:placeholder:text-gray-600"
                      value={point}
                      placeholder="输入要点..."
                      onChange={(e) => updateKeyPoint(si, pi, e.target.value)}
                    />
                    <button
                      className={cn(
                        "shrink-0 text-gray-300 dark:text-gray-600 hover:text-red-400 dark:hover:text-red-500 transition-colors text-xs leading-none",
                        section.keyPoints.length <= 1 && "invisible"
                      )}
                      onClick={() => removeKeyPoint(si, pi)}
                    >
                      ✕
                    </button>
                  </li>
                ))}
                <li>
                  <button
                    className="mt-1 text-xs text-brand-500 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors"
                    onClick={() => addKeyPoint(si)}
                  >
                    + 添加要点
                  </button>
                </li>
              </ul>

              {section.estimatedWords && (
                <p className="ml-7 text-xs text-gray-400 dark:text-gray-600">
                  ~{section.estimatedWords} 字
                </p>
              )}
            </li>
          ))}
        </ol>

        {editedOutline.estimatedTotalWords && (
          <p className="text-right text-xs text-gray-400 dark:text-gray-500">
            {(t as any).estimatedWords ?? "预计总字数"}：~{editedOutline.estimatedTotalWords} 字
          </p>
        )}
      </div>
    </div>
  );
}
