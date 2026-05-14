"use client";

import { Card, CardHeader, CardContent } from "@/components/ui/card";
import type { ResearchSource } from "../page";

interface ResearchResultsProps {
  sources: ResearchSource[];
}

export function ResearchResults({ sources }: ResearchResultsProps) {
  if (sources.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <svg className="h-4 w-4 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          Sources ({sources.length})
        </h2>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {sources.map((source, i) => (
            <li key={i} className="group">
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-lg p-2 -mx-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <p className="text-sm font-medium text-brand-600 dark:text-brand-400 group-hover:underline line-clamp-1">
                  {source.title}
                </p>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                  {source.snippet}
                </p>
              </a>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
