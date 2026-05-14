'use client';

export function TokenUsage({ inputTokens, outputTokens }: { inputTokens: number; outputTokens: number }) {
  const total = inputTokens + outputTokens;
  if (total === 0) return null;
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
      Tokens: {total.toLocaleString()} (in: {inputTokens.toLocaleString()}, out: {outputTokens.toLocaleString()})
    </div>
  );
}
