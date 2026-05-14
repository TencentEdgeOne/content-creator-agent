'use client';

import { useI18n } from '@/lib/i18n';

export function LanguageToggle() {
  const { locale, setLocale } = useI18n();
  return (
    <button
      onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
      aria-label="Toggle language"
      className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
    >
      {locale === 'zh' ? 'EN' : '中文'}
    </button>
  );
}
