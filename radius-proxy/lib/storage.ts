export interface OAuthCodeEntry {
  username: string
  emailDomain?: string
  class?: string
  scope?: string
  groups?: string[]
  code_challenge?: string
  code_challenge_method?: string
  expiresAt?: number
  clientId?: string
  redirectUri?: string
  nonce?: string
}
export type RefreshTokenEntry = OAuthCodeEntry

// Single-process storage: consume removes synchronously before any await can interleave.
// Bound both stores and prune on writes to prevent unbounded memory growth.
class MemoryStorage {
  private codes = new Map<string, OAuthCodeEntry>()
  private refreshTokens = new Map<string, RefreshTokenEntry>()
  private prune(store: Map<string, OAuthCodeEntry>) {
    for (const [key, entry] of store) if (!entry.expiresAt || entry.expiresAt <= Date.now()) store.delete(key)
  }
  private put(store: Map<string, OAuthCodeEntry>, key: string, entry: OAuthCodeEntry) {
    this.prune(store)
    // Revoke the oldest session under pressure so new logins remain available.
    if (store.size >= 10000) store.delete(store.keys().next().value!)
    store.set(key, entry)
  }
  private take(store: Map<string, OAuthCodeEntry>, key: string) {
    const entry = store.get(key)
    store.delete(key)
    return entry?.expiresAt && entry.expiresAt > Date.now() ? entry : undefined
  }
  async set(code: string, entry: OAuthCodeEntry) { this.put(this.codes, code, entry) }
  async get(code: string) { return this.codes.get(code) }
  async delete(code: string) { this.codes.delete(code) }
  async consume(code: string) { return this.take(this.codes, code) }
  async cleanup() { this.prune(this.codes) }
  async setRefreshToken(token: string, entry: RefreshTokenEntry) { this.put(this.refreshTokens, token, entry) }
  async getRefreshToken(token: string) { return this.refreshTokens.get(token) }
  async deleteRefreshToken(token: string) { this.refreshTokens.delete(token) }
  async consumeRefreshToken(token: string) { return this.take(this.refreshTokens, token) }
  async cleanupRefreshTokens() { this.prune(this.refreshTokens) }
}
let storage = new MemoryStorage()
export function getStorage() { return storage }
export async function cleanupExpiredCodes() { await storage.cleanup(); await storage.cleanupRefreshTokens() }
export async function closeStorage() { storage = new MemoryStorage() }
