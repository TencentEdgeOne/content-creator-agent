"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { ConversationProvider, useConversationId } from "./lib/conversation-context";
import { TopicForm } from "./components/topic-form";
import { ArticleEditor } from "./components/article-editor";
import { ArticleStats } from "./components/article-stats";
import { ProcessSteps } from "./components/process-steps";
import { RefineBar } from "./components/refine-bar";
import { ArticleHistory } from "./components/article-history";
import { ExportPanel } from "./components/export-panel";
import { SeoPanel } from "./components/seo-panel";
import { OutlineCard } from "./components/outline-card";
import { DeployButtons } from "./components/deploy-buttons";
import { LanguageToggle } from "@/components/ui/language-toggle";
import { TokenUsage } from "@/components/ui/token-usage";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

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

export interface ArticleVersion {
  content: string;
  createdAt: string;
  wordCount: number;
}

export default function Home() {
  return (
    <ConversationProvider>
      <HomeInner />
    </ConversationProvider>
  );
}

function HomeInner() {
  const { t, locale } = useI18n();
  const conversationId = useConversationId();
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
  const [sources, setSources] = useState<string>("");
  const [keywords, setKeywords] = useState("");
  const [style, setStyle] = useState("");
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [tokenUsage, setTokenUsage] = useState({ input: 0, output: 0 });
  const [stepTokens, setStepTokens] = useState<Record<string, number>>({});
  const [shouldAutoSave, setShouldAutoSave] = useState(false);
  const [isRefining, setIsRefining] = useState(false);

  // Version management state
  const [currentArticleId, setCurrentArticleId] = useState<string | null>(null);
  const [versions, setVersions] = useState<ArticleVersion[]>([]);
  const [currentVersionIndex, setCurrentVersionIndex] = useState(0);
  const [isLoadingArticle, setIsLoadingArticle] = useState(false);
  const [refinedSectionIndex, setRefinedSectionIndex] = useState<number | null>(null);

  // Outline state
  const [outline, setOutline] = useState<any | null>(null);
  const [isGeneratingOutline, setIsGeneratingOutline] = useState(false);
  const [pendingParams, setPendingParams] = useState<{ topic: string; keywords: string; style: string; length: string; mode?: string } | null>(null);

  // Preferences & notifications
  const [preferences, setPreferences] = useState<any>(null);
  const [storageWarning, setStorageWarning] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'error' | 'success' } | null>(null);

  // Ref for triggering scroll
  const editorScrollRef = useRef<{ scrollToTop: () => void; scrollToSection: (index: number) => void } | null>(null);

  // Load preferences on mount
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
        if (data?.error === 'BLOB_NOT_CONFIGURED') {
          setStorageWarning(true);
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
      // Step 1: Generate outline first
      setIsGeneratingOutline(true);
      setOutline(null);
      setApiError(null);
      setPendingParams(params);
      setContent("");
      setSeoData(null);
      setSources("");
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
          headers: { 'Content-Type': 'application/json', 'makers-conversation-id': conversationId },
          body: JSON.stringify(params),
        });

        if (res.ok) {
          const data = await res.json();
          let parsedOutline = data.outline;
          // If outline has raw field (backend parse failed), try to extract from raw
          if (parsedOutline?.raw && parsedOutline.sections?.length <= 1) {
            try {
              const rawMatch = parsedOutline.raw.match(/\{[\s\S]*\}/);
              if (rawMatch) {
                const fromRaw = JSON.parse(rawMatch[0]);
                if (fromRaw.sections?.length > 1) parsedOutline = fromRaw;
              }
            } catch {}
          }
          setOutline(parsedOutline);
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

  // Outline confirmed → start writing
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

  // Direct article generation
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
          headers: { "Content-Type": "application/json", "makers-conversation-id": conversationId },
          body: JSON.stringify({
            topic: params.topic,
            keywords: params.keywords,
            style: params.style,
            length: params.length,
            outline: outlineData || undefined,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          let errMsg = `${t.requestFailed} (${response.status})`;
          try {
            const errBody = await response.text();
            if (response.status === 429 || errBody.includes('quota')) {
              errMsg = t.quotaExhausted;
            } else if (errBody) {
              errMsg = errBody.slice(0, 200);
            }
          } catch {}
          throw new Error(errMsg);
        }

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
                    if (event.content) {
                      setSources(event.content);
                    }
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
                  const errContent = event.content || "";
                  if (errContent.includes("429") || errContent.includes("quota")) {
                    setApiError(t.quotaExhausted);
                  } else {
                    setApiError(errContent);
                  }
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

        // Strip any leaked model internal markup (DSML)
        setContent((prev) => prev.replace(/<[｜|]*DSML[｜|]*[^>]*>[\s\S]*?<\/[｜|]*DSML[｜|]*[^>]*>/g, '').replace(/<[｜|]*DSML[\s\S]*/g, '').trim());

        // Trigger auto-save after generation completes (creates new article)
        setShouldAutoSave(true);

        // Scroll to top after generation completes
        setTimeout(() => editorScrollRef.current?.scrollToTop(), 100);

        // Record usage to preferences
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
          setApiError((err as Error).message || t.generationFailed);
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
    setIsGeneratingOutline(false);
    // The EdgeOne runtime requires makers-conversation-id header on ALL agent
    // endpoints (including /stop). To avoid sticky-routing /stop to the busy
    // chat instance, we generate a DIFFERENT UUID for the stop request header.
    // The actual target conversation_id is passed via body.
    fetch("/stop", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "makers-conversation-id": crypto.randomUUID(),
      },
      body: JSON.stringify({ conversation_id: conversationId }),
    }).catch(() => {});
  }, [abortController, conversationId]);

  const handleRefineStart = useCallback(() => {
    setIsRefining(true);
    updateStep("refine", "active");
  }, [updateStep]);

  const handleRefineEnd = useCallback((sectionIndex?: number) => {
    setIsRefining(false);
    updateStep("refine", "done");
    setRefinedSectionIndex(sectionIndex ?? null);

    setShouldAutoSave(true);

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
    setShouldAutoSave(false);
    if (savedId) {
      setCurrentArticleId(savedId);
      if (savedVersions.length > 0) {
        setVersions(savedVersions);
        setCurrentVersionIndex(savedVersions.length - 1);
      }
    }
  }, []);

  const handleSaveError = useCallback((message: string) => {
    setToastMessage({ text: message, type: 'error' });
    setTimeout(() => setToastMessage(null), 5000);
  }, []);

  return (
    <div className="min-h-screen">
      {/* Toast notification (top-right) */}
      {toastMessage && (
        <div className="fixed top-4 right-4 z-[100] animate-in slide-in-from-top-2 fade-in duration-300">
          <div className={cn(
            "flex items-start gap-2 rounded-lg border px-4 py-3 shadow-lg max-w-sm",
            toastMessage.type === 'error'
              ? "bg-red-50 border-red-200 dark:bg-red-900/30 dark:border-red-800"
              : "bg-green-50 border-green-200 dark:bg-green-900/30 dark:border-green-800"
          )}>
            <span className={cn(
              "mt-0.5 flex-shrink-0",
              toastMessage.type === 'error' ? "text-red-500" : "text-green-500"
            )}>
              {toastMessage.type === 'error' ? (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
            </span>
            <p className={cn(
              "text-xs flex-1",
              toastMessage.type === 'error'
                ? "text-red-700 dark:text-red-300"
                : "text-green-700 dark:text-green-300"
            )}>
              {toastMessage.text}
            </p>
            <button
              onClick={() => setToastMessage(null)}
              className={cn(
                "flex-shrink-0 text-sm leading-none",
                toastMessage.type === 'error'
                  ? "text-red-400 hover:text-red-600"
                  : "text-green-400 hover:text-green-600"
              )}
            >
              &times;
            </button>
          </div>
        </div>
      )}
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
            <DeployButtons
              templateSlug="content-creator-agent"
              githubUrl="https://github.com/edgeone-pages-test/content-creator-agent"
              lang={locale}
            />
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
      {storageWarning && (
        <div className="mx-auto max-w-[1600px] px-4 pt-4">
          <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <span className="text-amber-500 mt-0.5">⚠️</span>
            <div className="flex-1">
              <p className="text-xs text-amber-700 dark:text-amber-400">{t.blobNotConfigured}</p>
            </div>
            <button onClick={() => setStorageWarning(false)} className="text-amber-400 hover:text-amber-600 text-sm leading-none">×</button>
          </div>
        </div>
      )}
      {apiError && (
        <div className="mx-auto max-w-[1600px] px-4 pt-4">
          <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <span className="text-red-500 mt-0.5">❌</span>
            <div className="flex-1">
              <p className="text-xs text-red-700 dark:text-red-400">{apiError}</p>
            </div>
            <button onClick={() => setApiError(null)} className="text-red-400 hover:text-red-600 text-sm leading-none">×</button>
          </div>
        </div>
      )}
      <div className="mx-auto max-w-[1600px] px-4 py-6">
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Left sidebar */}
          <aside className="w-full lg:w-[280px] flex-shrink-0 space-y-4">
            <TopicForm onGenerate={handleGenerate} onStop={handleStop} isGenerating={isGenerating || isGeneratingOutline} preferences={preferences} />
            <ProcessSteps steps={steps} stepTokens={stepTokens} />
          </aside>

          {/* Main content */}
          <main className="flex-1 min-w-0 space-y-4">
            {/* Outline confirmation */}
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
              hasOutline={!!outline}
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
              onSaveError={handleSaveError}
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
