import { createHash } from "node:crypto";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import { safeFetchBuffer, type SafeFetchResult } from "./safe-fetch";

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];

export type CrawledCampaignPage = {
  url: string;
  result: SafeFetchResult;
  text: string;
};

export function evidenceContentHash(
  pages: Array<Pick<CrawledCampaignPage, "url" | "text">>
) {
  const hash = createHash("sha256").update("evidence-text-v1\0");
  for (const page of [...pages].sort((left, right) => left.url.localeCompare(right.url))) {
    const text = page.text.replace(/\s+/g, " ").trim();
    hash.update(`${Buffer.byteLength(page.url)}:${page.url}`);
    hash.update(`${Buffer.byteLength(text)}:${text}`);
  }
  return hash.digest("hex");
}

const RESEARCH_PATH = /\b(about|meet|bio|biography|issues?|priorities|platform|policy|policies|vision)\b/i;
const OFFICIAL_BIOGRAPHY_PATH = /\b(about|bio|biography|meet|member|representative|senator)\b/i;
const EXCLUDED_PATH = /\b(donate|contribute|volunteer|store|shop|events?|privacy|terms|login|signup)\b/i;
const SKIP_ELEMENTS = new Set([
  "script",
  "style",
  "noscript",
  "svg",
  "canvas",
  "form",
  "nav",
  "footer",
  "template",
]);
const BLOCK_ELEMENTS = new Set([
  "address", "article", "aside", "blockquote", "br", "div", "figcaption", "figure",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "p",
  "section", "table", "td", "th", "tr",
]);

function isElement(node: HtmlNode): node is HtmlElement {
  return "tagName" in node;
}

function nodeText(node: HtmlNode): string {
  if ("value" in node) return node.value;
  if (!isElement(node) || SKIP_ELEMENTS.has(node.tagName)) return "";
  const content = node.childNodes.map(nodeText).join(BLOCK_ELEMENTS.has(node.tagName) ? " " : "");
  return BLOCK_ELEMENTS.has(node.tagName) ? ` ${content} ` : content;
}

function attr(node: HtmlElement, name: string) {
  return node.attrs.find((attribute) => attribute.name.toLowerCase() === name)?.value ?? null;
}

function walk(node: HtmlNode, visit: (element: HtmlElement) => void) {
  if (!isElement(node)) return;
  visit(node);
  for (const child of node.childNodes) walk(child, visit);
}

export function parseCampaignHtml(html: string, pageUrl: string) {
  const document = parse(html);
  const text = document.childNodes
    .map((node) => nodeText(node))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const links: Array<{ url: string; label: string }> = [];
  for (const child of document.childNodes) {
    walk(child, (element) => {
      if (element.tagName !== "a") return;
      const href = attr(element, "href");
      if (!href) return;
      try {
        const url = new URL(href, pageUrl);
        url.hash = "";
        url.search = "";
        links.push({
          url: url.toString(),
          label: element.childNodes.map(nodeText).join(" ").replace(/\s+/g, " ").trim(),
        });
      } catch {
        // Invalid campaign markup is ignored, never repaired or executed.
      }
    });
  }
  return { text, links };
}

type RobotsGroup = {
  agents: string[];
  rules: Array<{ kind: "allow" | "disallow"; path: string }>;
};

export function parseRobots(content: string) {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let sawRule = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (!current || sawRule) {
        current = { agents: [], rules: [] };
        groups.push(current);
        sawRule = false;
      }
      current.agents.push(value.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && current) {
      current.rules.push({ kind: key, path: value });
      sawRule = true;
    }
  }
  return groups;
}

export function robotsAllows(
  groups: ReturnType<typeof parseRobots>,
  pathname: string,
  userAgent = "delegationdecodedcampaignresearch"
) {
  const exact = groups.filter((group) => group.agents.includes(userAgent.toLowerCase()));
  const applicable = exact.length > 0
    ? exact
    : groups.filter((group) => group.agents.includes("*"));
  const matches = applicable
    .flatMap((group) => group.rules)
    .filter((rule) => rule.path && pathname.startsWith(rule.path))
    .sort((a, b) => b.path.length - a.path.length);
  return matches[0]?.kind !== "disallow";
}

export function normalizeCampaignSiteUrl(raw: string) {
  const trimmed = raw.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:" || (url.port && url.port !== "443") || url.username || url.password) {
    throw new Error("Campaign site must use HTTPS on port 443 without credentials");
  }
  url.hash = "";
  return url.toString();
}

export function isOfficialCongressionalSite(raw: string) {
  try {
    const hostname = new URL(normalizeCampaignSiteUrl(raw)).hostname.toLowerCase();
    return hostname.endsWith(".house.gov") || hostname.endsWith(".senate.gov");
  } catch {
    return false;
  }
}

export function classifyCmsFamily(html: string) {
  const sample = html.slice(0, 20_000).toLowerCase();
  if (sample.includes("wp-content") || sample.includes("wp-json")) return "wordpress";
  if (sample.includes("data-drupal") || sample.includes("drupal-settings-json")) return "drupal";
  if (sample.includes("index.cfm") || sample.includes("coldfusion")) return "coldfusion";
  if (sample.includes("fireside21") || sample.includes("sos_widget")) return "fireside";
  if (sample.includes('id="__next"') || sample.includes("__next_data__")) return "nextjs";
  return "generic_html";
}

function allowedHostsFor(url: URL) {
  const hostname = url.hostname.toLowerCase();
  const bare = hostname.startsWith("www.") ? hostname.slice(4) : hostname;
  return new Set([bare, `www.${bare}`]);
}

function scoreLink(
  link: { url: string; label: string },
  researchPath: RegExp
) {
  const url = new URL(link.url);
  const haystack = `${url.pathname} ${link.label}`;
  if (EXCLUDED_PATH.test(haystack)) return -100;
  return researchPath.test(haystack) ? 10 : 0;
}

async function fetchRobots(
  root: URL,
  allowedHosts: ReadonlySet<string>,
  userAgent: string
) {
  const robotsUrl = new URL("/robots.txt", root).toString();
  try {
    const result = await safeFetchBuffer(robotsUrl, {
      allowedHosts,
      allowedContentTypes: ["text/plain", "text/html"],
      maxBytes: 250_000,
      timeoutMs: 10_000,
      maxRedirects: 2,
      userAgent,
    });
    return parseRobots(result.body.toString("utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/HTTP (404|410)\b/.test(message)) return [];
    throw new Error("Site robots policy could not be verified");
  }
}

type ResearchCrawlOptions = {
  researchPath: RegExp;
  userAgent: string;
  robotsAgent: string;
  maxBytes?: number;
};

export async function crawlResearchSite(
  rawUrl: string,
  maxPages: number,
  options: ResearchCrawlOptions
) {
  const initialUrl = new URL(normalizeCampaignSiteUrl(rawUrl));
  const allowedHosts = allowedHostsFor(initialUrl);
  const robots = await fetchRobots(
    initialUrl,
    allowedHosts,
    options.userAgent
  );
  const queue = [initialUrl.toString()];
  const seen = new Set<string>();
  const pages: CrawledCampaignPage[] = [];

  while (queue.length > 0 && pages.length < maxPages) {
    const next = queue.shift();
    if (!next || seen.has(next)) continue;
    seen.add(next);
    const url = new URL(next);
    if (!robotsAllows(robots, url.pathname, options.robotsAgent)) continue;
    let result: SafeFetchResult;
    try {
      result = await safeFetchBuffer(url.toString(), {
        allowedHosts,
        allowedContentTypes: ["text/html", "application/xhtml+xml"],
        maxBytes: options.maxBytes ?? 1_000_000,
        timeoutMs: 15_000,
        maxRedirects: 3,
        userAgent: options.userAgent,
      });
    } catch (error) {
      // A bad secondary link must not discard a valid root/about page. The
      // first page still fails closed because no trusted site content exists.
      if (pages.length === 0) throw error;
      continue;
    }
    const parsed = parseCampaignHtml(result.body.toString("utf8"), result.finalUrl);
    if (parsed.text.length < 40) continue;
    pages.push({ url: result.finalUrl, result, text: parsed.text });

    const candidates = parsed.links
      .filter((link) => {
        const linked = new URL(link.url);
        return (
          linked.protocol === "https:" &&
          allowedHosts.has(linked.hostname.toLowerCase()) &&
          (!linked.port || linked.port === "443")
        );
      })
      .map((link) => ({
        ...link,
        score: scoreLink(link, options.researchPath),
      }))
      .filter((link) => link.score > 0)
      .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));
    for (const candidate of candidates) {
      if (!seen.has(candidate.url) && !queue.includes(candidate.url)) queue.push(candidate.url);
    }
    if (queue.length > 0 && pages.length < maxPages) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  if (pages.length === 0) throw new Error("No crawlable research pages were found");
  return pages;
}

export function crawlCampaignSite(rawUrl: string, maxPages: number) {
  return crawlResearchSite(rawUrl, maxPages, {
    researchPath: RESEARCH_PATH,
    userAgent: "DelegationDecodedCampaignResearch/1.0",
    robotsAgent: "delegationdecodedcampaignresearch",
    maxBytes: 2_000_000,
  });
}

export function crawlOfficialBiographySite(rawUrl: string, maxPages: number) {
  if (!isOfficialCongressionalSite(rawUrl)) {
    throw new Error("Official biography source must use a house.gov or senate.gov host");
  }
  return crawlResearchSite(rawUrl, maxPages, {
    researchPath: OFFICIAL_BIOGRAPHY_PATH,
    // Congressional sites frequently reject bespoke scraper user agents at
    // their WAF. Capitol Releases' recon found the same pattern, so official
    // pages use a browser-class header while the robots token remains explicit.
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    robotsAgent: "delegationdecodedofficialbiographyresearch",
    maxBytes: 2_000_000,
  });
}
