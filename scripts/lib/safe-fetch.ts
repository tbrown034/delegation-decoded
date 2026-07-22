import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request } from "node:https";

type SafeFetchOptions = {
  allowedHosts?: ReadonlySet<string>;
  allowedContentTypes: readonly string[];
  maxBytes: number;
  timeoutMs?: number;
  maxRedirects?: number;
  userAgent?: string;
};

export type SafeFetchResult = {
  body: Buffer;
  finalUrl: string;
  contentType: string;
  etag: string | null;
  lastModified: string | null;
};

function isPrivateIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string) {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice(7);
    return isIP(mapped) !== 4 || isPrivateIpv4(mapped);
  }
  return (
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  );
}

export function isBlockedAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

async function resolvePublicAddress(hostname: string) {
  if (isIP(hostname) !== 0) {
    if (isBlockedAddress(hostname)) throw new Error("Source host resolves to a blocked address");
    return { address: hostname, family: isIP(hostname) as 4 | 6 };
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw new Error("Source host resolves to a blocked address");
  }
  return addresses[0];
}

function validateUrl(rawUrl: string, allowedHosts?: ReadonlySet<string>) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || (url.port && url.port !== "443")) {
    throw new Error("Only HTTPS sources on port 443 are allowed");
  }
  if (url.username || url.password) throw new Error("Source URLs cannot contain credentials");
  const host = url.hostname.toLowerCase();
  if (allowedHosts && !allowedHosts.has(host)) throw new Error("Source host is not allowlisted");
  return url;
}

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export async function safeFetchBuffer(
  rawUrl: string,
  options: SafeFetchOptions,
  redirectCount = 0
): Promise<SafeFetchResult> {
  const url = validateUrl(rawUrl, options.allowedHosts);
  const resolved = await resolvePublicAddress(url.hostname);
  const timeoutMs = options.timeoutMs ?? 20_000;

  return new Promise((resolve, reject) => {
    const req = request(
      {
        protocol: "https:",
        hostname: resolved.address,
        family: resolved.family,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: {
          Host: url.host,
          Accept: options.allowedContentTypes.join(", "),
          "User-Agent": options.userAgent ?? "DelegationDecodedElectionIngest/1.0",
        },
        servername: url.hostname,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.resume();
          const location = headerValue(response.headers.location);
          const maxRedirects = options.maxRedirects ?? 3;
          if (!location || redirectCount >= maxRedirects) {
            reject(new Error("Source redirect was missing or exceeded the redirect limit"));
            return;
          }
          const nextUrl = new URL(location, url).toString();
          safeFetchBuffer(nextUrl, options, redirectCount + 1).then(resolve, reject);
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`Source returned HTTP ${status}`));
          return;
        }

        const contentType = (headerValue(response.headers["content-type"]) ?? "")
          .split(";", 1)[0]
          .trim()
          .toLowerCase();
        if (!options.allowedContentTypes.some((allowed) => contentType === allowed)) {
          response.resume();
          reject(new Error(`Unexpected source content type: ${contentType || "missing"}`));
          return;
        }

        const declaredLength = Number(headerValue(response.headers["content-length"]) ?? 0);
        if (declaredLength > options.maxBytes) {
          response.destroy();
          reject(new Error("Source exceeds the configured size limit"));
          return;
        }

        const chunks: Buffer[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > options.maxBytes) {
            response.destroy(new Error("Source exceeded the configured size limit"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({
            body: Buffer.concat(chunks),
            finalUrl: url.toString(),
            contentType,
            etag: headerValue(response.headers.etag),
            lastModified: headerValue(response.headers["last-modified"]),
          });
        });
        response.on("error", reject);
      }
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error("Source request timed out")));
    req.on("error", reject);
    req.end();
  });
}
