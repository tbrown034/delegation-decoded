/**
 * Recon: fetch a sample Senate PTR detail page and report whether it is
 * HTML (web-form filing) or a PDF link (paper filing).
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const BASE = "https://efdsearch.senate.gov";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 delegation-decoded/recon";

interface JarEntry { name: string; value: string }
function parseSetCookie(headers: string[]): JarEntry[] {
  const out: JarEntry[] = [];
  for (const raw of headers) {
    const first = raw.split(";")[0];
    const eq = first.indexOf("=");
    if (eq >= 0) out.push({ name: first.slice(0, eq).trim(), value: first.slice(eq + 1).trim() });
  }
  return out;
}
function jarToHeader(jar: JarEntry[]): string {
  return jar.map((c) => `${c.name}=${c.value}`).join("; ");
}
function mergeJar(jar: JarEntry[], next: JarEntry[]): JarEntry[] {
  const map = new Map(jar.map((c) => [c.name, c.value]));
  for (const c of next) map.set(c.name, c.value);
  return Array.from(map, ([name, value]) => ({ name, value }));
}
function csrfFrom(html: string): string | null {
  return html.match(/name=["']csrfmiddlewaretoken["']\s+value=["']([^"']+)["']/)?.[1] ?? null;
}

async function acceptTos(): Promise<JarEntry[]> {
  let jar: JarEntry[] = [];
  const home = await fetch(`${BASE}/search/home/`, { headers: { "User-Agent": UA } });
  jar = mergeJar(jar, parseSetCookie(home.headers.getSetCookie()));
  const csrf = csrfFrom(await home.text())!;
  const tos = await fetch(`${BASE}/search/home/`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: jarToHeader(jar),
      Referer: `${BASE}/search/home/`,
    },
    body: new URLSearchParams({ csrfmiddlewaretoken: csrf, prohibition_agreement: "1" }).toString(),
  });
  jar = mergeJar(jar, parseSetCookie(tos.headers.getSetCookie()));
  return jar;
}

async function main() {
  const jar = await acceptTos();
  // Sample UUIDs from the previous recon
  const SAMPLES = [
    "680da3d8-5f81-43a3-a658-0493c0070378", // Banks 04/20/2026
    "e9d6ab5f-3a50-49bc-9f00-3ef4655045aa", // Boozman 04/14/2026
    "aa38bdb0-5847-4bec-8e36-80d6ffc90837", // Capito 04/...
  ];
  for (const id of SAMPLES) {
    const url = `${BASE}/search/view/ptr/${id}/`;
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Cookie: jarToHeader(jar), Referer: `${BASE}/search/` },
    });
    console.log(`\n=== ${id} ===`);
    console.log(`status=${r.status} content-type=${r.headers.get("content-type")} url=${r.url}`);
    const text = await r.text();
    console.log(`len=${text.length}`);
    // Look for clear signals
    const isPdf = r.headers.get("content-type")?.includes("pdf") ?? false;
    const hasTable = /<table[^>]*class=["'][^"']*table[^"']*["'][^>]*>/i.test(text);
    const pdfLink = text.match(/href=["']([^"']+\.pdf[^"']*)["']/i)?.[1];
    const tickerCols = text.match(/Ticker|ticker symbol/i)?.[0];
    const headRows = (text.match(/<tr[^>]*>/g) || []).length;
    console.log(`isPdf=${isPdf} hasTable=${hasTable} pdfLink=${pdfLink} tickerCols=${tickerCols} <tr> count=${headRows}`);
    // Print a snippet of the body (between <body> tags or the title)
    const titleMatch = text.match(/<title>([^<]+)<\/title>/);
    console.log(`title=${titleMatch?.[1]}`);
    // First table fragment
    const tableMatch = text.match(/<table[\s\S]{0,2500}?<\/table>/i);
    if (tableMatch) {
      console.log(`first table snippet (${tableMatch[0].length} chars):`);
      console.log(tableMatch[0].slice(0, 1200).replace(/\s+/g, " "));
    } else if (pdfLink) {
      console.log(`pdf link: ${pdfLink}`);
    } else {
      console.log("first 800 chars of body:");
      console.log(text.slice(0, 800));
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
