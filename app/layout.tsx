import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Nav } from "@/components/nav";
import { Footer } from "@/components/footer";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Delegation Decoded",
    template: "%s | Delegation Decoded",
  },
  description:
    "Congressional accountability tracking, organized by state delegation. Member profiles, legislation, committee assignments, and campaign finance for all 50 states.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="flex min-h-full flex-col bg-white text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
        <Nav />
        <main className="flex-1">{children}</main>
        <Footer />
        <Analytics />
      </body>
    </html>
  );
}
