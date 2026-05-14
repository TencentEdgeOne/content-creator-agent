'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useI18n } from '@/lib/i18n';

interface ExportPanelProps {
  content: string;
}

function markdownToHtml(md: string): string {
  let html = md;
  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // Bold / italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // Code blocks
  html = html.replace(/```[\s\S]*?```/g, (match) => {
    const code = match.replace(/```\w*\n?/, '').replace(/```$/, '');
    return `<pre><code>${code}</code></pre>`;
  });
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Blockquotes
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  // Paragraphs: wrap non-tag lines
  html = html
    .split('\n\n')
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      if (/^<(h[1-6]|ul|ol|li|blockquote|pre|div)/.test(trimmed)) return trimmed;
      return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');
  return html;
}

function markdownToPlainText(md: string): string {
  let text = md;
  text = text.replace(/^#{1,6}\s+/gm, '');
  text = text.replace(/\*\*(.+?)\*\*/g, '$1');
  text = text.replace(/\*(.+?)\*/g, '$1');
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  text = text.replace(/```[\s\S]*?```/g, (match) => match.replace(/```\w*\n?/, '').replace(/```$/, ''));
  text = text.replace(/`([^`]+)`/g, '$1');
  text = text.replace(/^> /gm, '');
  text = text.replace(/^- /gm, '• ');
  return text.trim();
}

export function ExportPanel({ content }: ExportPanelProps) {
  const { t } = useI18n();
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }, []);

  const copyToClipboard = useCallback(
    async (text: string, label: string) => {
      try {
        await navigator.clipboard.writeText(text);
        showToast(`${label} ${t.copied}!`);
      } catch {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast(`${label} ${t.copied}!`);
      }
    },
    [showToast, t.copied]
  );

  const handleCopyMarkdown = useCallback(() => {
    copyToClipboard(content, 'Markdown');
  }, [content, copyToClipboard]);

  const handleCopyHtml = useCallback(() => {
    const html = markdownToHtml(content);
    copyToClipboard(html, 'HTML');
  }, [content, copyToClipboard]);

  const handleCopyText = useCallback(() => {
    const text = markdownToPlainText(content);
    copyToClipboard(text, 'Text');
  }, [content, copyToClipboard]);

  const handleDownloadMd = useCallback(() => {
    const firstLine = content.split('\n').find((l) => l.trim()) || 'article';
    const filename = firstLine.replace(/^#+\s*/, '').replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_').slice(0, 50) + '.md';
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(t.downloadMd);
  }, [content, showToast, t.downloadMd]);

  return (
    <Card className="mt-4 relative">
      {toast && (
        <div className="absolute -top-10 left-1/2 -translate-x-1/2 rounded-lg bg-gray-900 px-3 py-1.5 text-xs text-white shadow-lg dark:bg-gray-100 dark:text-gray-900 animate-fade-in z-10">
          {toast}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 p-4">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 mr-2">{t.export}:</span>
        <Button variant="outline" size="sm" onClick={handleCopyMarkdown}>
          <svg className="mr-1.5 h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          {t.copyMarkdown}
        </Button>
        <Button variant="outline" size="sm" onClick={handleCopyHtml}>
          <svg className="mr-1.5 h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
          {t.copyHtml}
        </Button>
        <Button variant="outline" size="sm" onClick={handleCopyText}>
          <svg className="mr-1.5 h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          {t.copyText}
        </Button>
        <Button variant="outline" size="sm" onClick={handleDownloadMd}>
          <svg className="mr-1.5 h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          {t.downloadMd}
        </Button>
      </div>
    </Card>
  );
}
