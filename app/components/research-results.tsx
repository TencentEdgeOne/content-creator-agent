"use client";

import { Card, CardHeader, CardContent } from "@/components/ui/card";

interface ResearchResultsProps {
  sources: string;
}

export function ResearchResults({ sources }: ResearchResultsProps) {
  if (!sources) return null;

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <svg className="h-4 w-4 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          Web Search Results
        </h2>
      </CardHeader>
      <CardContent>
        <pre className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-words leading-relaxed max-h-48 overflow-y-auto">
          {sources}
        </pre>
      </CardContent>
    </Card>
  );
}
