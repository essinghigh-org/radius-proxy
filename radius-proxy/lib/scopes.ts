// Central definition of supported OAuth/OIDC scopes for the radius-proxy.
// These are advertised via the discovery document and enforced at the
// authorization endpoint.

export const SUPPORTED_SCOPES = new Set<string>(["openid", "profile", "email"])

// Default scopes applied when the client does not request any.
export const DEFAULT_SCOPES: string[] = ["openid", "profile"]

/**
 * Validate and normalize a raw scope string from the authorize request.
 * Rules:
 *  - Empty / missing => DEFAULT_SCOPES
 *  - All tokens must be in SUPPORTED_SCOPES else throw
 *  - Duplicate tokens removed (preserve first occurrence order)
 *  - Tokens are lowercased
 *  - Returns canonical space-delimited scope string
 */
export function normalizeRequestedScopes(raw: string | null | undefined): string {
  const val = (raw || '').trim()
  if (!val) return DEFAULT_SCOPES.join(' ')
  const parts = val.split(/\s+/).filter(Boolean).map(p => p.toLowerCase())
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of parts) {
    if (!SUPPORTED_SCOPES.has(p)) {
      throw new Error(`unsupported_scope:${p}`)
    }
    if (!seen.has(p)) {
      seen.add(p)
      out.push(p)
    }
  }
  if (out.length === 0) return DEFAULT_SCOPES.join(' ')
  return out.join(' ')
}
