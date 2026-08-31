import type { MetadataRoute } from "next";

const BASE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://delegationdecoded.org";

// /api stays closed except the two families worth indexing: member photos
// (Google Images) and the bulk CSVs (Dataset search, AI assistants). More
// specific Allow rules beat the /api/ Disallow for compliant crawlers.
const SHARED_RULES = {
  allow: ["/", "/api/photo/", "/api/data/"],
  disallow: ["/api/"],
};

// AI crawlers are welcomed by name: the site wants to be cited by
// assistants, and explicit rules survive any future tightening of the
// wildcard. Bytespider is excluded — it has a history of ignoring robots
// directives and feeds no assistant that cites sources.
const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ClaudeBot",
  "Claude-User",
  "PerplexityBot",
  "Google-Extended",
  "CCBot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        ...SHARED_RULES,
      },
      ...AI_CRAWLERS.map((userAgent) => ({
        userAgent,
        ...SHARED_RULES,
      })),
      {
        userAgent: "Bytespider",
        disallow: "/",
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
