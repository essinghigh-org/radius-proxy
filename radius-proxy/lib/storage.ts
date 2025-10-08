import fs from 'fs'
import path from 'path'
import { config } from './config'
import { warn, info, error } from './log'

export interface OAuthCodeEntry {
  username: string
  class?: string
  scope?: string
  groups?: string[]
  expiresAt?: number
}

export interface StorageBackend {
  set(code: string, entry: OAuthCodeEntry): Promise<void>
  get(code: string): Promise<OAuthCodeEntry | undefined>
  delete(code: string): Promise<void>
  cleanup(): Promise<void>
  close?(): Promise<void>
}

class MemoryStorage implements StorageBackend {
  private codes: Record<string, OAuthCodeEntry> = {}

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
    for (const [code, entry] of Object.entries(this.codes)) {
      if (entry.expiresAt && now > entry.expiresAt) {
        delete this.codes[code]
      }
    }
  }
}

class SqliteStorage implements StorageBackend {
  private db: any = null
  private dbPath: string

  constructor(dbPath: string) {
    this.dbPath = dbPath
  }

  private async ensureDatabase(): Promise<void> {
    if (this.db) return

    try {
      // Import better-sqlite3 dynamically to handle optional dependency
      const Database = require('better-sqlite3')
      
      // Ensure directory exists
      const dir = path.dirname(this.dbPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      this.db = new Database(this.dbPath)
      
      // Create table if it doesn't exist
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS oauth_codes (
          code TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          class TEXT,
          scope TEXT,
          groups TEXT, -- JSON string array
          expires_at INTEGER
        )
      `)

      // Create index on expires_at for efficient cleanup
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_oauth_codes_expires_at 
        ON oauth_codes(expires_at)
      `)

      info('[storage] SQLite database initialized', { path: this.dbPath })
    } catch (err) {
      error('[storage] Failed to initialize SQLite database', { 
        path: this.dbPath, 
        error: (err as Error).message 
      })
      throw err
    }
  }

  async set(code: string, entry: OAuthCodeEntry): Promise<void> {
    await this.ensureDatabase()
    
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO oauth_codes 
      (code, username, class, scope, groups, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    
    stmt.run(
      code,
      entry.username,
      entry.class || null,
      entry.scope || null,
      entry.groups ? JSON.stringify(entry.groups) : null,
      entry.expiresAt || null
    )
  }

  async get(code: string): Promise<OAuthCodeEntry | undefined> {
    await this.ensureDatabase()
    
    const stmt = this.db.prepare(`
      SELECT username, class, scope, groups, expires_at 
      FROM oauth_codes 
      WHERE code = ?
    `)
    
    const row = stmt.get(code)
    if (!row) return undefined

    return {
      username: row.username,
      class: row.class || undefined,
      scope: row.scope || undefined,
      groups: row.groups ? JSON.parse(row.groups) : undefined,
      expiresAt: row.expires_at || undefined
    }
  }

  async delete(code: string): Promise<void> {
    await this.ensureDatabase()
    
    const stmt = this.db.prepare('DELETE FROM oauth_codes WHERE code = ?')
    stmt.run(code)
  }

  async cleanup(): Promise<void> {
    await this.ensureDatabase()
    
    const now = Date.now()
    const stmt = this.db.prepare('DELETE FROM oauth_codes WHERE expires_at < ?')
    const result = stmt.run(now)
    
    if (result.changes > 0) {
      info('[storage] Cleaned up expired OAuth codes', { count: result.changes })
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }
}

// Global storage instance
let storageInstance: StorageBackend | null = null

export function getStorage(): StorageBackend {
  if (!storageInstance) {
    const dbPath = config.DATABASE_PATH
    if (dbPath) {
      try {
        storageInstance = new SqliteStorage(dbPath)
        info('[storage] Using SQLite storage', { path: dbPath })
      } catch (err) {
        warn('[storage] Failed to initialize SQLite, falling back to memory storage', { 
          error: (err as Error).message 
        })
        storageInstance = new MemoryStorage()
      }
    } else {
      storageInstance = new MemoryStorage()
      info('[storage] Using in-memory storage')
    }
  }
  return storageInstance
}

// Cleanup function to be called periodically
export async function cleanupExpiredCodes(): Promise<void> {
  try {
    await getStorage().cleanup()
  } catch (err) {
    warn('[storage] Failed to cleanup expired codes', { error: (err as Error).message })
  }
}

// Close storage when process exits
export async function closeStorage(): Promise<void> {
  if (storageInstance && storageInstance.close) {
    await storageInstance.close()
    storageInstance = null
  }
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