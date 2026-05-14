"use client";

import { cn } from "@/lib/utils";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import type { Step, StepStatus } from "../page";

interface ProcessStepsProps {
  steps: Record<Step, StepStatus>;
  stepTokens?: Record<string, number>;
}

const STEP_ICONS: Record<Step, string> = {
  research: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
  outline: "M4 6h16M4 10h16M4 14h16M4 18h16",
  writing: "M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z",
  review: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
  refine: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
};

// Each step maps to its own token key
const STEP_TOKEN_KEY: Record<Step, string | null> = {
  research: null,       // research is part of outline call
  outline: 'outline',
  writing: 'writing',
  review: null,
  refine: 'refine',
};

function formatTokens(n: number): string {
  if (n === 0) return '';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k tokens`;
  return `${n} tokens`;
}

export function ProcessSteps({ steps, stepTokens = {} }: ProcessStepsProps) {
  const { t } = useI18n();

  const stepLabels: Record<Step, string> = {
    research: t.research,
    outline: t.outline,
    writing: t.writing,
    review: t.review,
    refine: t.refine,
  };

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <svg className="h-4 w-4 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          {t.workflow}
        </h2>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {(Object.keys(STEP_ICONS) as Step[]).map((key, index) => {
            const status = steps[key];
            const isLast = index === Object.keys(STEP_ICONS).length - 1;
            const tokenKey = STEP_TOKEN_KEY[key];
            const tokens = tokenKey ? stepTokens[tokenKey] : undefined;

            return (
              <div key={key} className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-full border-2 transition-all duration-300",
                      {
                        "border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900": status === "pending",
                        "border-brand-500 bg-brand-50 dark:bg-brand-900/30": status === "active",
                        "border-green-500 bg-green-50 dark:bg-green-900/30": status === "done",
                      }
                    )}
                  >
                    {status === "done" ? (
                      <svg className="h-3.5 w-3.5 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : status === "active" ? (
                      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-brand-500" />
                    ) : (
                      <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d={STEP_ICONS[key]} />
                      </svg>
                    )}
                  </div>
                  {!isLast && (
                    <div
                      className={cn("w-0.5 h-5 transition-colors duration-300", {
                        "bg-gray-200 dark:bg-gray-700": status !== "done",
                        "bg-green-300 dark:bg-green-700": status === "done",
                      })}
                    />
                  )}
                </div>

                <div className="flex items-center justify-between flex-1 min-w-0">
                  <span
                    className={cn("mt-1 text-sm transition-colors duration-300", {
                      "text-gray-400 dark:text-gray-500": status === "pending",
                      "text-brand-600 dark:text-brand-400 font-medium": status === "active",
                      "text-gray-700 dark:text-gray-300": status === "done",
                    })}
                  >
                    {stepLabels[key]}
                  </span>
                  {status === "done" && tokens && tokens > 0 && (
                    <span className="mt-1 inline-flex items-center rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                      {formatTokens(tokens)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
