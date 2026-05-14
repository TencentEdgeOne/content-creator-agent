'use client';

import { useState, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface Section {
  title: string;
  content: string;
  index: number;
  level: number; // 1=H1, 2=H2, 3=H3
}

interface RefineBarProps {
  content: string;
  onRefineComplete: (newContent: string) => void;
  onRefineStart: () => void;
  onRefineEnd: (sectionIndex?: number) => void;
  onTokenUsage?: (tokens: { input: number; output: number }) => void;
  isRefining?: boolean;
}

function parseSections(content: string): Section[] {
  const lines = content.split('\n');
  const sections: Section[] = [];
  let currentTitle = '';
  let currentContent = '';
  let currentLevel = 0;
  let sectionIndex = -1;

  for (const line of lines) {
    const match = line.match(/^(#{1,3})\s+(.+)$/);
    if (match) {
      if (sectionIndex >= 0) {
        sections.push({ title: currentTitle, content: currentContent.trim(), index: sectionIndex, level: currentLevel });
      }
      currentLevel = match[1].length;
      currentTitle = match[2].trim();
      currentContent = line + '\n';
      sectionIndex = sections.length;
    } else if (sectionIndex >= 0) {
      currentContent += line + '\n';
    }
  }

  if (sectionIndex >= 0) {
    sections.push({ title: currentTitle, content: currentContent.trim(), index: sectionIndex, level: currentLevel });
  }

  return sections;
}

function replaceSectionInContent(fullContent: string, sectionIndex: number, newSectionContent: string): string {
  const lines = fullContent.split('\n');
  const sections: { start: number; end: number }[] = [];
  let currentStart = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^#{1,3}\s+/)) {
      if (currentStart >= 0) {
        sections.push({ start: currentStart, end: i - 1 });
      }
      currentStart = i;
    }
  }
  if (currentStart >= 0) {
    sections.push({ start: currentStart, end: lines.length - 1 });
  }

  if (sectionIndex < 0 || sectionIndex >= sections.length) return fullContent;

  const { start, end } = sections[sectionIndex];
  const before = lines.slice(0, start);
  const after = lines.slice(end + 1);

  return [...before, newSectionContent, ...after].join('\n');
}

export function RefineBar({ content, onRefineComplete, onRefineStart, onRefineEnd, onTokenUsage, isRefining = false }: RefineBarProps) {
  const { t } = useI18n();
  const [instruction, setInstruction] = useState('');
  const [localRefining, setLocalRefining] = useState(false);
  const [selectedSection, setSelectedSection] = useState<number | null>(null);

  const sections = useMemo(() => parseSections(content), [content]);

  const handleRefine = useCallback(async () => {
    if (!instruction.trim() || !content) return;

    setLocalRefining(true);
    onRefineStart();
    let newContent = '';

    const isSection = selectedSection !== null && sections[selectedSection];
    const sectionData = isSection ? sections[selectedSection] : null;

    try {
      const body: Record<string, any> = {
        article: content,
        instruction: instruction.trim(),
      };

      if (sectionData) {
        body.section = {
          title: sectionData.title,
          content: sectionData.content,
          index: sectionData.index,
        };
      }

      const response = await fetch('/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) throw new Error('Refine failed');

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') break;

          try {
            const event = JSON.parse(data);
            if (event.type === 'ai_response') {
              newContent += event.content;
              // If section mode, splice back in real-time
              if (sectionData) {
                const fullUpdated = replaceSectionInContent(content, selectedSection!, newContent);
                onRefineComplete(fullUpdated);
              } else {
                onRefineComplete(newContent);
              }
            } else if (event.type === 'usage' && onTokenUsage) {
              onTokenUsage({ input: event.input_tokens || 0, output: event.output_tokens || 0 });
            }
          } catch {}
        }
      }

      setInstruction('');
      setSelectedSection(null);
    } catch (err) {
      console.error('Refine error:', err);
    } finally {
      setLocalRefining(false);
      onRefineEnd(sectionData ? selectedSection! : undefined);
    }
  }, [content, instruction, onRefineComplete, onRefineStart, onRefineEnd, selectedSection, sections]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleRefine();
      }
    },
    [handleRefine]
  );

  const effectiveRefining = isRefining || localRefining;

  return (
    <Card className="mt-4">
      {/* Section selector */}
      {sections.length > 0 && (
        <div className="border-b border-gray-100 dark:border-gray-800 px-5 py-3">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2.5">{t.selectSection}:</p>
          <div className="flex items-center gap-2 flex-wrap max-h-[130px] overflow-y-auto py-0.5">
            <button
              onClick={() => setSelectedSection(null)}
              className={cn(
                "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap",
                selectedSection === null
                  ? "bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
              )}
            >
              {t.fullArticle}
            </button>
            {sections.filter(s => s.level <= 2).map((section) => {
              // Find H3 children for this H2
              const h3Children = sections.filter(
                (s, idx) => s.level === 3 && idx > section.index &&
                  (sections.findIndex((next, ni) => ni > section.index && next.level <= 2) === -1 ||
                   idx < sections.findIndex((next, ni) => ni > section.index && next.level <= 2))
              );

              return (
                <button
                  key={section.index}
                  onClick={() => {
                    setSelectedSection(section.index);
                    // Scroll to section in editor
                    const headings = document.querySelectorAll('[data-article-content] h1, [data-article-content] h2, [data-article-content] h3');
                    for (const el of headings) {
                      if (el.textContent?.trim() === section.title) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        break;
                      }
                    }
                  }}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    "block max-w-[130px] overflow-hidden text-ellipsis whitespace-nowrap",
                    selectedSection === section.index
                      ? "bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300 ring-1 ring-brand-300"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                  )}
                  title={section.title + (h3Children.length > 0 ? `\n  └ ${h3Children.map(c => c.title).join('\n  └ ')}` : '')}
                >
                  {section.title}
                </button>
              );
            })}
            {/* Show H3 sections as smaller chips if there are few H2s */}
            {sections.filter(s => s.level <= 2).length <= 3 && sections.filter(s => s.level === 3).map((section) => (
              <button
                key={section.index}
                onClick={() => {
                  setSelectedSection(section.index);
                  const headings = document.querySelectorAll('[data-article-content] h1, [data-article-content] h2, [data-article-content] h3');
                  for (const el of headings) {
                    if (el.textContent?.trim() === section.title) {
                      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      break;
                    }
                  }
                }}
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[11px] transition-colors",
                  "block max-w-[110px] overflow-hidden text-ellipsis whitespace-nowrap",
                  selectedSection === section.index
                    ? "bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300 ring-1 ring-brand-200"
                    : "bg-gray-50 text-gray-500 hover:bg-gray-100 dark:bg-gray-800/50 dark:text-gray-500 dark:hover:bg-gray-700"
                )}
                title={section.title}
              >
                └ {section.title}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <input
              type="text"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                selectedSection !== null && sections[selectedSection]
                  ? `${t.modifySection}: ${sections[selectedSection].title}`
                  : t.refinePlaceholder
              }
              disabled={effectiveRefining}
              className={cn(
                'flex h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm',
                'placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20',
                'dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500',
                'disabled:opacity-50'
              )}
              aria-label={t.refineLabel}
            />
          </div>
          <Button
            onClick={handleRefine}
            disabled={effectiveRefining || !instruction.trim()}
            size="md"
            className="flex-shrink-0 h-10"
          >
            {effectiveRefining ? (
              <>
                <svg className="mr-2 h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {t.refining}
              </>
            ) : (
              <>
                <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                {t.refine}
              </>
            )}
          </Button>
        </div>
        {selectedSection !== null && sections[selectedSection] && (
          <p className="mt-2 text-xs text-brand-500 font-medium">
            {t.sectionMode}: {sections[selectedSection].title}
          </p>
        )}
      </div>
    </Card>
  );
}
