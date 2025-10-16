import { info, warn } from './log'

export interface OAuthCodeEntry {
  username: string
  emailDomain?: string
  class?: string
  scope?: string
  groups?: string[]
  code_challenge?: string
  code_challenge_method?: string
  expiresAt?: number
}

export interface RefreshTokenEntry {
  username: string
  emailDomain?: string
  class?: string
  scope?: string
  groups?: string[]
  expiresAt?: number
  clientId?: string
}

export interface StorageBackend {
  set(code: string, entry: OAuthCodeEntry): Promise<void>
  get(code: string): Promise<OAuthCodeEntry | undefined>
  delete(code: string): Promise<void>
  cleanup(): Promise<void>

  // Refresh token methods
  setRefreshToken(token: string, entry: RefreshTokenEntry): Promise<void>
  getRefreshToken(token: string): Promise<RefreshTokenEntry | undefined>
  deleteRefreshToken(token: string): Promise<void>
  cleanupRefreshTokens(): Promise<void>
}

class MemoryStorage implements StorageBackend {
  private codes: Record<string, OAuthCodeEntry> = {}
  private refreshTokens: Record<string, RefreshTokenEntry> = {}

  async set(code: string, entry: OAuthCodeEntry): Promise<void> {
    this.codes[code] = entry
  }

  async get(code: string): Promise<OAuthCodeEntry | undefined> {
    return this.codes[code]
  }

  async delete(code: string): Promise<void> {
    delete this.codes[code]
  }

  async cleanup(): Promise<void> {
    const now = Date.now()
    let cleaned = 0
    for (const [code, entry] of Object.entries(this.codes)) {
      if (entry.expiresAt && now > entry.expiresAt) {
        delete this.codes[code]
        cleaned++
      }
    }
    if (cleaned > 0) {
      info('[storage] Cleaned up expired OAuth codes', { count: cleaned })
    }
  }

  async setRefreshToken(token: string, entry: RefreshTokenEntry): Promise<void> {
    this.refreshTokens[token] = entry
  }

  async getRefreshToken(token: string): Promise<RefreshTokenEntry | undefined> {
    return this.refreshTokens[token]
  }

  async deleteRefreshToken(token: string): Promise<void> {
    delete this.refreshTokens[token]
  }

  async cleanupRefreshTokens(): Promise<void> {
    const now = Date.now()
    let cleaned = 0
    for (const [token, entry] of Object.entries(this.refreshTokens)) {
      if (entry.expiresAt && now > entry.expiresAt) {
        delete this.refreshTokens[token]
        cleaned++
      }
    }
    if (cleaned > 0) {
      info('[storage] Cleaned up expired refresh tokens', { count: cleaned })
    }
  }
}

// Global storage instance
let storageInstance: StorageBackend | null = null

export function getStorage(): StorageBackend {
  if (!storageInstance) {
    storageInstance = new MemoryStorage()
    info('[storage] Using in-memory storage')
  }
  return storageInstance
}

// Cleanup function to be called periodically
export async function cleanupExpiredCodes(): Promise<void> {
  try {
    const storage = getStorage()
    await storage.cleanup()
    await storage.cleanupRefreshTokens()
  } catch (err) {
    warn('[storage] Failed to cleanup expired codes', { error: (err as Error).message })
  }
}

// Close storage when process exits (no-op for memory storage but kept for API compatibility)
export async function closeStorage(): Promise<void> {
  storageInstance = null
}

// Register cleanup handlers
process.on('SIGINT', async () => {
  await closeStorage()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  await closeStorage()
  process.exit(0)
})