import type { Metadata } from "next";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
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

// Display serif for headline moments (marketing landing page, and the
// primary heading on the shortlist/venue pages) — a warm, characterful face
// fitting a dining brand, distinct from Geist, which stays the body font and
// every other UI element everywhere, including inside the app itself.
const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600"],
  style: ["normal", "italic"],
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
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
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
