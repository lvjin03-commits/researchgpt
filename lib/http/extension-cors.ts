const ALLOWED_EXTENSION_ORIGIN_PREFIX = "chrome-extension://";
const ALLOWED_PAGE_ORIGINS = new Set(["https://scholar.google.com"]);

export function extensionCorsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin") ?? "";

  if (
    !origin.startsWith(ALLOWED_EXTENSION_ORIGIN_PREFIX) &&
    !ALLOWED_PAGE_ORIGINS.has(origin)
  ) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    Vary: "Origin",
  };
}

export function extensionCorsPreflight(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: extensionCorsHeaders(request),
  });
}
