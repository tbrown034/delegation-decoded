/**
 * Recon: poke the Senate eFD search to learn its TOS gate, CSRF flow,
 * search payload, and PTR detail-page format. Throwaway — once we know
 * what the service returns, we'll build the real ingester from this.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const BASE = "https://efdsearch.senate.gov";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 delegation-decoded/recon";

interface JarEntry { name: string; value: string }

function parseSetCookie(setCookieHeaders: string[]): JarEntry[] {
  const out: JarEntry[] = [];
  for (const raw of setCookieHeaders) {
    const first = raw.split(";")[0];
    const eq = first.indexOf("=");
    if (eq < 0) continue;
    out.push({ name: first.slice(0, eq).trim(), value: first.slice(eq + 1).trim() });
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

function extractCsrf(html: string): string | null {
  const m = html.match(/name=["']csrfmiddlewaretoken["']\s+value=["']([^"']+)["']/);
  return m ? m[1] : null;
}

async function main() {
  let jar: JarEntry[] = [];

  // Step 1: GET home page to get csrf cookie + token
  console.log("→ GET /search/home/");
  const home = await fetch(`${BASE}/search/home/`, { headers: { "User-Agent": UA } });
  jar = mergeJar(jar, parseSetCookie(home.headers.getSetCookie()));
  const homeHtml = await home.text();
  const csrf = extractCsrf(homeHtml);
  console.log(`  status=${home.status} csrf=${csrf?.slice(0, 12)}… cookies=${jar.map((c) => c.name).join(",")}`);

  if (!csrf) {
    console.error("No csrf token on home page; here is first 500 chars:");
    console.error(homeHtml.slice(0, 500));
    process.exit(1);
  }

  // Step 2: POST TOS acceptance
  console.log("→ POST /search/home/ (accept TOS)");
  const tosBody = new URLSearchParams({
    csrfmiddlewaretoken: csrf,
    prohibition_agreement: "1",
  });
  const tos = await fetch(`${BASE}/search/home/`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: jarToHeader(jar),
      Referer: `${BASE}/search/home/`,
    },
    body: tosBody.toString(),
  });
  jar = mergeJar(jar, parseSetCookie(tos.headers.getSetCookie()));
  console.log(`  status=${tos.status} location=${tos.headers.get("location")}`);

  // Step 3: GET /search/ to get a fresh CSRF for the JSON API
  console.log("→ GET /search/");
  const search = await fetch(`${BASE}/search/`, {
    headers: { "User-Agent": UA, Cookie: jarToHeader(jar) },
  });
  jar = mergeJar(jar, parseSetCookie(search.headers.getSetCookie()));
  const searchHtml = await search.text();
  const csrf2 = extractCsrf(searchHtml) ?? csrf;
  console.log(`  status=${search.status} html_len=${searchHtml.length} new_csrf=${csrf2?.slice(0, 12)}…`);

  // Step 4: POST to the search data endpoint for 2026 PTRs by Senators
  console.log("→ POST /search/report/data/");
  const dataBody = new URLSearchParams({
    csrfmiddlewaretoken: csrf2,
    report_types: "[11]", // 11 = PTR
    filer_types: "[1]", // 1 = Senator
    submitted_start_date: "01/01/2026 00:00:00",
    submitted_end_date: "12/31/2026 23:59:59",
    candidate_state: "",
    senator_state: "",
    office_id: "",
    first_name: "",
    last_name: "",
    start: "0",
    length: "10",
  });
  const data = await fetch(`${BASE}/search/report/data/`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: jarToHeader(jar),
      Referer: `${BASE}/search/`,
      "X-CSRFToken": csrf2,
    },
    body: dataBody.toString(),
  });
  console.log(`  status=${data.status} content-type=${data.headers.get("content-type")}`);
  const text = await data.text();
  console.log(`  len=${text.length}`);
  console.log(`  first 800 chars:\n${text.slice(0, 800)}`);

  // If JSON, show summary
  if (data.headers.get("content-type")?.includes("json")) {
    try {
      const json = JSON.parse(text);
      console.log(`  recordsTotal=${json.recordsTotal}, returned=${json.data?.length}`);
      if (json.data?.length) {
        console.log("  first 3 rows:");
        for (const row of json.data.slice(0, 3)) console.log("   ", row);
      }
    } catch {}
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
