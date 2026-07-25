import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { NavBar } from "@/components/nav-bar";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Private Dining Finder",
  description: "Search and compare private dining venues for corporate offsites.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      {/* suppressHydrationWarning on html/body only: some browser extensions
          (translation tools, ad blockers) inject attributes like
          data-yd-* into these tags before React hydrates, which otherwise
          trips a false-positive hydration mismatch warning. This does not
          suppress mismatches anywhere else in the tree. */}
      <body className="min-h-full flex flex-col bg-muted/30" suppressHydrationWarning>
        <NavBar />
        <main className="flex-1">{children}</main>
        <Toaster />
      </body>
    </html>
  );
}
