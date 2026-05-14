"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { TopicForm } from "./components/topic-form";
import { ArticleEditor } from "./components/article-editor";
import { ArticleStats } from "./components/article-stats";
import { ProcessSteps } from "./components/process-steps";
import { ResearchResults } from "./components/research-results";
import { RefineBar } from "./components/refine-bar";
import { ArticleHistory } from "./components/article-history";
import { ExportPanel } from "./components/export-panel";
import { SeoPanel } from "./components/seo-panel";
import { OutlineCard } from "./components/outline-card";
import { LanguageToggle } from "@/components/ui/language-toggle";
import { TokenUsage } from "@/components/ui/token-usage";
import { useI18n } from "@/lib/i18n";

export type StepStatus = "pending" | "active" | "done";
export type Step = "research" | "outline" | "writing" | "review" | "refine";

export interface SeoData {
  score: number;
  keywordDensity: number;
  readabilityScore: number;
  wordCount: number;
  headingStructure?: { h1: number; h2: number; h3: number };
  suggestions: { text: string; severity: "info" | "warning" | "error" }[];
}

export interface ResearchSource {
  title: string;
  url: string;
  snippet: string;
}

export interface ArticleVersion {
  content: string;
  createdAt: string;
  wordCount: number;
}

export default function Home() {
  const { t } = useI18n();
  const [content, setContent] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [steps, setSteps] = useState<Record<Step, StepStatus>>({
    research: "pending",
    outline: "pending",
    writing: "pending",
    review: "pending",
    refine: "pending",
  });
  const [seoData, setSeoData] = useState<SeoData | null>(null);
  const [sources, setSources] = useState<ResearchSource[]>([]);
  const [keywords, setKeywords] = useState("");
  const [style, setStyle] = useState("");
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [tokenUsage, setTokenUsage] = useState({ input: 0, output: 0 });
  const [stepTokens, setStepTokens] = useState<Record<string, number>>({});  // per-step token tracking
  const [shouldAutoSave, setShouldAutoSave] = useState(false);
  const [isRefining, setIsRefining] = useState(false);

  // Version management state
  const [currentArticleId, setCurrentArticleId] = useState<string | null>(null);
  const [versions, setVersions] = useState<ArticleVersion[]>([]);
  const [currentVersionIndex, setCurrentVersionIndex] = useState(0);
  const [isLoadingArticle, setIsLoadingArticle] = useState(false);
  const [refinedSectionIndex, setRefinedSectionIndex] = useState<number | null>(null);

  // Outline state (human-in-the-loop)
  const [outline, setOutline] = useState<any | null>(null);
  const [isGeneratingOutline, setIsGeneratingOutline] = useState(false);
  const [pendingParams, setPendingParams] = useState<{ topic: string; keywords: string; style: string; length: string; mode?: string } | null>(null);

  // Preferences state (long-term memory)
  const [preferences, setPreferences] = useState<any>(null);

  // Ref for triggering scroll
  const editorScrollRef = useRef<{ scrollToTop: () => void; scrollToSection: (index: number) => void } | null>(null);

  // Load preferences on mount (long-term memory)
  useEffect(() => {
    fetch('/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get', userId: 'default' }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.preferences) {
          setPreferences(data.preferences);
        }
      })
      .catch(() => {});
  }, []);

  const updateStep = useCallback((step: Step, status: StepStatus) => {
    setSteps((prev) => ({ ...prev, [step]: status }));
  }, []);

  const resetSteps = useCallback(() => {
    setSteps({
      research: "pending",
      outline: "pending",
      writing: "pending",
      review: "pending",
      refine: "pending",
    });
  }, []);

  const handleGenerate = useCallback(
    async (params: { topic: string; keywords: string; style: string; length: string; mode?: string }) => {
      // Step 1: Generate outline first (human-in-the-loop)
      setIsGeneratingOutline(true);
      setOutline(null);
      setPendingParams(params);
      setContent("");
      setSeoData(null);
      setSources([]);
      setKeywords(params.keywords);
      setStyle(params.style);
      setTokenUsage({ input: 0, output: 0 });
      setStepTokens({});
      setShouldAutoSave(false);
      setCurrentArticleId(null);
      setVersions([]);
      setCurrentVersionIndex(0);
      resetSteps();
      updateStep("research", "active");

      try {
        const res = await fetch('/outline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        });

        if (res.ok) {
          const data = await res.json();
          setOutline(data.outline);
          if (data.usage) {
            const outlineTokens = (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0);
            setTokenUsage({ input: data.usage.input_tokens || 0, output: data.usage.output_tokens || 0 });
            setStepTokens(prev => ({ ...prev, outline: outlineTokens }));
          }
          updateStep("research", "done");
          updateStep("outline", "active");
        } else {
          // If outline fails, fall through to direct generation
          console.error('Outline generation failed, falling back to direct generation');
          setIsGeneratingOutline(false);
          handleDirectGenerate(params);
          return;
        }
      } catch (err) {
        console.error('Outline error:', err);
        setIsGeneratingOutline(false);
        handleDirectGenerate(params);
        return;
      }

      setIsGeneratingOutline(false);
    },
    [updateStep, resetSteps]
  );

  // Outline confirmed → start article generation
  const handleOutlineConfirm = useCallback(
    (confirmedOutline: any) => {
      setOutline(null);
      updateStep("outline", "done");
      if (pendingParams) {
        handleDirectGenerate(pendingParams, confirmedOutline);
      }
    },
    [pendingParams, updateStep]
  );

  // Regenerate outline
  const handleOutlineRegenerate = useCallback(() => {
    if (pendingParams) {
      handleGenerate(pendingParams);
    }
  }, [pendingParams, handleGenerate]);

  // Skip outline → generate directly
  const handleOutlineDismiss = useCallback(() => {
    setOutline(null);
    updateStep("outline", "done");
    if (pendingParams) {
      handleDirectGenerate(pendingParams);
    }
  }, [pendingParams, updateStep]);

  // Direct article generation (the actual writing step)
  const handleDirectGenerate = useCallback(
    async (params: { topic: string; keywords: string; style: string; length: string; mode?: string }, outlineData?: any) => {
      setIsGenerating(true);
      updateStep("writing", "active");

      // Route to correct endpoint based on mode
      const endpoint = params.mode === 'deepagent' ? '/create' : '/create-lite';

      const controller = new AbortController();
      setAbortController(controller);

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topic: params.topic,
            keywords: params.keywords,
            style: params.style,
            length: params.length,
            outline: outlineData || undefined,
          }),
          signal: controller.signal,
        });

        if (!response.ok) throw new Error("Failed to start generation");

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";
        let currentStep: Step = "research";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") break;

            try {
              const event = JSON.parse(data);

              switch (event.type) {
                case "ping":
                  break;

                case "tool_call":
                  if (event.name === "search_web" || event.name === "search_topic") {
                    updateStep("research", "active");
                    currentStep = "research";
                  } else if (event.name === "create_outline") {
                    updateStep("research", "done");
                    updateStep("outline", "active");
                    currentStep = "outline";
                  } else if (event.name === "write_section") {
                    updateStep("outline", "done");
                    updateStep("writing", "active");
                    currentStep = "writing";
                  } else if (event.name === "check_grammar") {
                    updateStep("writing", "done");
                    updateStep("review", "active");
                    currentStep = "review";
                  }
                  break;

                case "tool_result":
                  if (event.name === "search_web" || event.name === "search_topic") {
                    try {
                      const results = JSON.parse(event.content);
                      if (Array.isArray(results)) {
                        setSources(results);
                      }
                    } catch {}
                  }
                  break;

                case "ai_response":
                  if (currentStep === "research" && !content) {
                    updateStep("research", "done");
                    updateStep("outline", "done");
                    updateStep("writing", "active");
                    currentStep = "writing";
                  }
                  setContent((prev) => prev + event.content);
                  break;

                case "error_message":
                  console.error("Stream error:", event.content);
                  break;

                case "usage":
                  const writingTokens = (event.input_tokens || 0) + (event.output_tokens || 0);
                  // Add to total (outline tokens + writing tokens)
                  setTokenUsage(prev => ({
                    input: prev.input + (event.input_tokens || 0),
                    output: prev.output + (event.output_tokens || 0),
                  }));
                  setStepTokens(prev => ({ ...prev, writing: writingTokens }));
                  break;
              }
            } catch {}
          }
        }

        // Mark all steps as done when stream completes
        const allSteps: Step[] = ["research", "outline", "writing", "review"];
        for (const step of allSteps) {
          updateStep(step, "done");
        }

        // Trigger auto-save after generation completes (creates new article)
        setShouldAutoSave(true);

        // Scroll to top after generation completes
        setTimeout(() => editorScrollRef.current?.scrollToTop(), 100);

        // Record usage to preferences (long-term memory)
        fetch('/preferences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'recordUsage',
            userId: 'default',
            topic: params.topic,
            keywords: params.keywords,
            style: params.style,
            length: params.length,
          }),
        }).then(r => r.ok ? r.json() : null).then(data => {
          if (data?.preferences) setPreferences(data.preferences);
        }).catch(() => {});
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          console.error("Generation error:", err);
        }
      } finally {
        setIsGenerating(false);
        setAbortController(null);
      }
    },
    [updateStep, resetSteps, content]
  );

  const handleStop = useCallback(() => {
    abortController?.abort();
    setIsGenerating(false);
  }, [abortController]);

  const handleRefineStart = useCallback(() => {
    setIsRefining(true);
    updateStep("refine", "active");
  }, [updateStep]);

  const handleRefineEnd = useCallback((sectionIndex?: number) => {
    setIsRefining(false);
    updateStep("refine", "done");
    setRefinedSectionIndex(sectionIndex ?? null);

    // After refine completes, add version to existing article (don't create new)
    // This is handled via the article-history component's addVersion logic
    setShouldAutoSave(true);

    // Scroll behavior
    setTimeout(() => {
      if (sectionIndex !== undefined && sectionIndex !== null) {
        editorScrollRef.current?.scrollToSection(sectionIndex);
      } else {
        editorScrollRef.current?.scrollToTop();
      }
    }, 100);
  }, [updateStep]);

  const handleRefineComplete = useCallback((newContent: string) => {
    setContent(newContent);
  }, []);

  const handleLoadArticle = useCallback((articleId: string, articleContent: string, articleKeywords: string, articleVersions: ArticleVersion[], versionIndex: number) => {
    setIsLoadingArticle(true);
    setCurrentArticleId(articleId);
    setVersions(articleVersions);
    setCurrentVersionIndex(versionIndex);
    setContent(articleContent);
    setKeywords(articleKeywords);

    // Smooth transition
    setTimeout(() => {
      setIsLoadingArticle(false);
      editorScrollRef.current?.scrollToTop();
    }, 300);
  }, []);

  const handleVersionSwitch = useCallback((index: number) => {
    if (index >= 0 && index < versions.length) {
      setIsLoadingArticle(true);
      setCurrentVersionIndex(index);
      setContent(versions[index].content);
      setTimeout(() => {
        setIsLoadingArticle(false);
        editorScrollRef.current?.scrollToTop();
      }, 300);
    }
  }, [versions]);

  const handleAutoSaved = useCallback((savedId: string, savedVersions: ArticleVersion[]) => {
    console.log('[page] handleAutoSaved called:', savedId, 'versions:', savedVersions.length);
    setShouldAutoSave(false);
    if (savedId) {
      setCurrentArticleId(savedId);
      if (savedVersions.length > 0) {
        setVersions(savedVersions);
        setCurrentVersionIndex(savedVersions.length - 1);
      }
    }
  }, []);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/80 backdrop-blur-sm dark:border-gray-800 dark:bg-gray-950/80">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t.title}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <TokenUsage inputTokens={tokenUsage.input} outputTokens={tokenUsage.output} />
            <LanguageToggle />
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span className="inline-flex h-2 w-2 rounded-full bg-green-500" />
              {t.poweredBy}
            </div>
          </div>
        </div>
      </header>

      {/* Main layout */}
      <div className="mx-auto max-w-[1600px] px-4 py-6">
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Left sidebar */}
          <aside className="w-full lg:w-[280px] flex-shrink-0 space-y-4">
            <TopicForm onGenerate={handleGenerate} onStop={handleStop} isGenerating={isGenerating || isGeneratingOutline} preferences={preferences} />
            <ProcessSteps steps={steps} stepTokens={stepTokens} />
            {sources.length > 0 && <ResearchResults sources={sources} />}
          </aside>

          {/* Main content */}
          <main className="flex-1 min-w-0 space-y-4">
            {/* Outline confirmation (human-in-the-loop) */}
            {outline && !isGenerating && (
              <OutlineCard
                outline={outline}
                onConfirm={handleOutlineConfirm}
                onRegenerate={handleOutlineRegenerate}
                onDismiss={handleOutlineDismiss}
                isLoading={isGeneratingOutline}
              />
            )}

            <ArticleEditor
              content={content}
              isGenerating={isGenerating}
              isRefining={isRefining}
              isLoadingArticle={isLoadingArticle}
              versions={versions}
              currentVersionIndex={currentVersionIndex}
              onVersionSwitch={handleVersionSwitch}
              refinedSectionIndex={refinedSectionIndex}
              scrollRef={editorScrollRef}
            />
            {content && !isGenerating && (
              <>
                <RefineBar
                  content={content}
                  onRefineComplete={handleRefineComplete}
                  onRefineStart={handleRefineStart}
                  onRefineEnd={handleRefineEnd}
                  onTokenUsage={(usage) => {
                    const refineTokens = usage.input + usage.output;
                    setTokenUsage(prev => ({ input: prev.input + usage.input, output: prev.output + usage.output }));
                    setStepTokens(prev => ({ ...prev, refine: refineTokens }));
                  }}
                  isRefining={isRefining}
                />
                <ExportPanel content={content} />
              </>
            )}
            {/* Article History - visible below the editor */}
            <ArticleHistory
              onLoadArticle={handleLoadArticle}
              currentContent={content}
              currentKeywords={keywords}
              currentStyle={style}
              shouldAutoSave={shouldAutoSave}
              onAutoSaved={handleAutoSaved}
              currentArticleId={currentArticleId}
            />
          </main>

          {/* Right sidebar */}
          <aside className="w-full lg:w-[300px] flex-shrink-0 space-y-4">
            <ArticleStats content={content} />
            <SeoPanel content={content} keywords={keywords} />
          </aside>
        </div>
      </div>
    </div>
  );
}
