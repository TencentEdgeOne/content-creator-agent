import type { Metadata } from "next";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Content Creator Assistant",
  description: "AI-powered content creation with research, writing, and SEO optimization",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 dark:bg-gray-950 antialiased">
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
