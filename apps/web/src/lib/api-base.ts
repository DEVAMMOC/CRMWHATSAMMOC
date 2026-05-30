// Resolve the base URL for API fetches.
//
// The web app is served over HTTPS, but the backend API is HTTP-only (sslip.io).
// A browser on an HTTPS page cannot call an HTTP URL — it blocks it as mixed
// content ("Failed to fetch"). To avoid that, when we detect we're in the browser
// on an HTTPS page and the configured base is an http:// URL, we fall back to an
// empty base so requests go to relative /api/* paths on the same HTTPS origin,
// which Next reverse-proxies to the backend server-side (see next.config.ts
// `rewrites`). In dev (http://localhost), the configured base is used as-is.
export function getApiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL ?? '';
  if (
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    configured.startsWith('http://')
  ) {
    return '';
  }
  return configured;
}
