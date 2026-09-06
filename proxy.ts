import { NextRequest, NextResponse } from "next/server";

// Routes that accept user input keep the per-request nonce CSP and must
// render dynamically (a cached page would carry a stale nonce). Everything
// else gets a static policy so pages can be served from the ISR cache
// without waking Postgres.
const NONCE_ROUTE_PREFIXES = ["/ask", "/find", "/compare", "/admin", "/health"];

const SHARED_DIRECTIVES = `
    default-src 'self';
    img-src 'self' blob: data: https://raw.githubusercontent.com https://www.congress.gov;
    font-src 'self';
    connect-src 'self' https://*.vercel-insights.com;
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    upgrade-insecure-requests;
`;

function compact(policy: string): string {
  return policy.replace(/\s{2,}/g, " ").trim();
}

// /admin pages authorize inside the page, but the root layout streams, so
// the 200 status line and the page title were already on the wire before the
// page's notFound() ran. The proxy answers 404 up front instead: with no key
// configured, or a key that does not match, an admin path does not exist.
async function adminKeyMatches(candidate: string | null) {
  const expected = process.env.ASK_ADMIN_KEY;
  if (!expected || !candidate) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

export async function proxy(request: NextRequest) {
  const isDev = process.env.NODE_ENV === "development";
  const { pathname } = request.nextUrl;

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (!(await adminKeyMatches(request.nextUrl.searchParams.get("key")))) {
      return new NextResponse("Not found", {
        status: 404,
        headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
      });
    }
  }

  const wantsNonce = NONCE_ROUTE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );

  if (wantsNonce) {
    const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
    const policy = compact(`
      script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""};
      style-src 'self' 'nonce-${nonce}';
      style-src-attr 'unsafe-inline';
      ${SHARED_DIRECTIVES}
    `);

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", policy);

    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("Content-Security-Policy", policy);
    return response;
  }

  const policy = compact(`
    script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""};
    style-src 'self' 'unsafe-inline';
    ${SHARED_DIRECTIVES}
  `);

  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
