import { config } from "./config"

// Server-side helper to derive the issuer/origin for requests. Kept out of
// `lib/utils.ts` so client bundles don't accidentally pull in server-only
// dependencies like `fs` via `lib/config` imports.
export function getIssuer(req: Request | string): string {
  try {
    let url: URL
    if (typeof req === 'string') {
      url = new URL(req)
    } else if ((req as Request).url) {
      url = new URL((req as Request).url)
    } else {
      throw new Error('no url')
    }

    const headers = (req as Request).headers
    if (headers && typeof headers.get === 'function') {
      // Prefer X-Forwarded-Host when present (set by proxies). Fall back to
      // the standard Host header which should reflect the original request
      // host/port as seen by the proxy. This prevents leaking the internal
      // server port (e.g. 54567) when the external request omitted it.
      const xfProto = headers.get('x-forwarded-proto')
      const xfHost = headers.get('x-forwarded-host') || headers.get('host')
      if (xfHost) url.host = xfHost.split(',')[0].trim()
      if (xfProto) url.protocol = xfProto.split(',')[0].trim() + ':'
    }
    return url.origin
  } catch {
    if (config.ISSUER) return config.ISSUER
    const host = config.HTTP_HOST || 'localhost'
    const port = config.HTTP_PORT ? `:${config.HTTP_PORT}` : ''
    const hostname = host === '0.0.0.0' ? 'localhost' : host
    return `http://${hostname}${port}`
  }
}
