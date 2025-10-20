import { config } from "./config"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

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
      const xfProtoRaw = headers.get('x-forwarded-proto')
      const xfHostRaw = headers.get('x-forwarded-host')
      const xfPortRaw = headers.get('x-forwarded-port')
      const hostHeader = headers.get('host')
      const xfProto = xfProtoRaw ? xfProtoRaw.split(',')[0].trim() : ''
      const xfHost = (xfHostRaw ? xfHostRaw.split(',')[0].trim() : '') || (hostHeader ? hostHeader.split(',')[0].trim() : '')

      if (xfHost) {
        url.host = xfHost // may include port
      }
      if (xfProto) {
        url.protocol = xfProto + ':'
      }

      // If x-forwarded-port explicitly provided, prefer it over any port embedded in host
      if (xfPortRaw) {
        const xfPort = xfPortRaw.split(',')[0].trim()
        if (/^\d+$/.test(xfPort)) url.port = xfPort
      }

      // Heuristics to drop internal dev / container ports that should not be visible externally.
      // If the proxy tells us the original scheme (e.g. https) but the port is a known internal
      // dev port (3000), configured HTTP_PORT, or one of our default internal ports (54567),
      // strip it so callers receive a clean origin.
      const internalPorts = new Set<string>(['3000', String(config.HTTP_PORT || ''), '54567'])
      if (xfProto && url.port) {
        const p = url.port
        const isStandard = (xfProto === 'https' && p === '443') || (xfProto === 'http' && p === '80')
        if (isStandard) {
          url.port = ''
        } else if (xfProto === 'https' && internalPorts.has(p)) {
          // Only drop non-standard internal port if forwarded host *did not* explicitly include a different public port
          // i.e., if x-forwarded-host itself contained a port we assume it is intentional.
          const forwardedHostHasPort = /:\d+$/.test(xfHost || '')
          if (!forwardedHostHasPort) url.port = ''
        }
      }
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

export function findProjectRoot(startDir: string = process.cwd()): string {
  // First try from startDir upwards
  let dir = startDir
  const maxDepth = 10
  for (let i = 0; i < maxDepth; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  // If not found, try from the directory of this utils file upwards
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  dir = __dirname
  for (let i = 0; i < maxDepth; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return startDir // fallback
}
