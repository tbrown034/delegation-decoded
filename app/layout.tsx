import type { Metadata } from "next";
import { DM_Sans, DM_Mono, Source_Serif_4 } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { Nav } from "@/components/nav";
import { Footer } from "@/components/footer";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  weight: ["400", "500"],
  subsets: ["latin"],
});

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  style: ["normal", "italic"],
});

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://delegationdecoded.org";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Delegation Decoded",
    template: "%s | Delegation Decoded",
  },
  description:
    "A state-by-state reporting guide to Congress and the 2026 midterms, with member profiles, votes, legislation, campaign finance, and FEC candidate filings.",
};

// Content routes cache for a day (data changes once daily via ingest);
// routes on the proxy's nonce-CSP list must override with force-dynamic
// because a cached page would carry a stale nonce.
export const revalidate = 86400;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${dmMono.variable} ${sourceSerif.variable} antialiased h-full`}
    >
      <body className="flex min-h-full flex-col bg-white font-[family-name:var(--font-dm-sans)] text-neutral-900">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-neutral-900 focus:px-3 focus:py-2 focus:text-sm focus:text-white"
        >
          Skip to content
        </a>
        <div className="h-[3px] w-full bg-neutral-800" />
        <Nav />
        <main id="main" className="flex-1">
          {children}
        </main>
        <Footer />
        <Analytics />
      </body>
    </html>
  );
}
