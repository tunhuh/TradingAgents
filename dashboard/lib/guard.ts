const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isLocal(hostOrUrl: string): boolean {
  try {
    const url = new URL(hostOrUrl.includes("://") ? hostOrUrl : `http://${hostOrUrl}`);
    return LOCAL_HOSTNAMES.has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * The dashboard has no auth, so endpoints that spend LLM quota or signal
 * processes only accept requests from this machine's own pages. Returns an
 * error message, or null when the request is allowed.
 */
export function localRequestError(req: Request, opts: { requireJson?: boolean } = {}): string | null {
  const host = req.headers.get("host");
  if (!host || !isLocal(host)) return "Requests must be made to localhost (Host header rejected)";
  if (req.headers.get("sec-fetch-site") === "cross-site") return "Cross-site requests are not allowed";
  const origin = req.headers.get("origin");
  if (origin && !isLocal(origin)) return "Request origin is not allowed";
  if (opts.requireJson && !(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return "Content-Type must be application/json";
  }
  return null;
}
