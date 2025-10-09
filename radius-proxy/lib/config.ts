import fs from "fs"
import path from "path"

type Config = {
  OAUTH_CLIENT_ID: string
  OAUTH_CLIENT_SECRET: string
  RADIUS_HOST: string
  RADIUS_SECRET: string
  RADIUS_PORT: number
  HTTP_HOST: string
  HTTP_PORT: number
  ISSUER?: string
  GRAFANA_SA_TOKEN?: string
  GRAFANA_BASE_URL?: string
  EMAIL_SUFFIX: string
  PERMITTED_CLASSES: string[]
  ADMIN_CLASSES: string[]
  // Optional explicit list of allowed redirect URIs for the OAuth client.
  // If empty, only same-origin redirects are allowed.
  REDIRECT_URIS: string[]
  // Map of class/group name -> array of Grafana team IDs
  CLASS_MAP: Record<string, number[]>
  // OAuth authorization code time-to-live (seconds)
  OAUTH_CODE_TTL: number
  // OAuth refresh token time-to-live (seconds)
  OAUTH_REFRESH_TOKEN_TTL: number
  // RADIUS request timeout in seconds (how long to wait for RADIUS server reply)
  RADIUS_TIMEOUT: number
}

function parseTomlSimple(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    // If the value starts a multi-line array or inline table, accumulate until matching bracket
    if ((val.startsWith("[") && !val.endsWith("]")) || (val.startsWith("{") && !val.endsWith("}"))) {
      let acc = val
      // track depth of nested brackets in case of nested arrays
      let depth = (acc.match(/[\[{]/g) || []).length - (acc.match(/[\]}]/g) || []).length
      while (depth > 0 && i + 1 < lines.length) {
        i++
        const next = lines[i]
        acc += '\n' + next
        depth = (acc.match(/[\[{]/g) || []).length - (acc.match(/[\]}]/g) || []).length
      }
      val = acc.trim()
    }
    // strip quotes for simple quoted strings
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1)
    out[key] = val
  }
  return out
}

// Safe numeric parsing with fallback for corrupted values
function safeParseNumber(value: string | undefined, fallback: number): number {
  if (!value || value.trim() === '') return fallback
  const parsed = Number(value)
  // Check for NaN, Infinity, or other invalid numeric values
  if (!Number.isFinite(parsed)) return fallback
  return parsed
}

function loadConfig(): Config {
  const root = process.cwd()
  const cfgPath = path.join(root, "config.toml")
  const exampleCfgPath = path.join(root, "config.example.toml")
  let base: Record<string, string> = {}
  
  // For tests, always use config.example.toml
  let cfgFile = ""
  if (process.env.NODE_ENV === 'test') {
    if (fs.existsSync(exampleCfgPath)) {
      cfgFile = exampleCfgPath
    }
  } else {
    // Prefer explicit config.toml but fall back to config.example.toml if present (useful for examples)
    if (fs.existsSync(cfgPath)) {
      cfgFile = cfgPath
    } else if (fs.existsSync(exampleCfgPath)) {
      cfgFile = exampleCfgPath
    }
  }
  
  if (cfgFile) {
    const content = fs.readFileSync(cfgFile, "utf8")
    base = parseTomlSimple(content)
  }

  // Allow env vars to override
  const cfg: Config = {
    OAUTH_CLIENT_ID: process.env.OAUTH_CLIENT_ID || base["OAUTH_CLIENT_ID"] || "grafana",
    OAUTH_CLIENT_SECRET: process.env.OAUTH_CLIENT_SECRET || base["OAUTH_CLIENT_SECRET"] || "secret",
    RADIUS_HOST: process.env.RADIUS_HOST || base["RADIUS_HOST"] || "127.0.0.1",
    RADIUS_SECRET: process.env.RADIUS_SECRET || base["RADIUS_SECRET"] || "secret",
    RADIUS_PORT: safeParseNumber(process.env.RADIUS_PORT || base["RADIUS_PORT"], 1812),
    HTTP_HOST: process.env.HTTP_HOST || base["HTTP_HOST"] || "0.0.0.0",
    HTTP_PORT: safeParseNumber(process.env.HTTP_PORT || base["HTTP_PORT"], 54567),
    ISSUER: process.env.ISSUER || base["ISSUER"],
    GRAFANA_SA_TOKEN: process.env.GRAFANA_SA_TOKEN || base["GRAFANA_SA_TOKEN"],
    GRAFANA_BASE_URL: process.env.GRAFANA_BASE_URL || base["GRAFANA_BASE_URL"],
    EMAIL_SUFFIX: process.env.EMAIL_SUFFIX || base["EMAIL_SUFFIX"] || "example.local",
    PERMITTED_CLASSES: (process.env.PERMITTED_CLASSES || base["PERMITTED_CLASSES"] || '')
      .split(',')
      .map(s=>s.trim())
      .filter(Boolean),
    ADMIN_CLASSES: (process.env.ADMIN_CLASSES || base["ADMIN_CLASSES"] || '')
      .split(',')
      .map(s=>s.trim())
      .filter(Boolean),
    REDIRECT_URIS: (() => {
      // Accept either a simple comma-separated string OR a TOML array literal like:
      // REDIRECT_URIS = ["https://a", "https://b"]
      const raw = process.env.REDIRECT_URIS || base["REDIRECT_URIS"] || ""
      const trimmed = raw.trim()
      const inner = (trimmed.startsWith("[") && trimmed.endsWith("]")) ? trimmed.slice(1, -1) : trimmed
      return inner
        .split(",")
        .map(s => s.trim().replace(/^"|"$/g, "")) // strip surrounding quotes if present
        .filter(Boolean)
    })(),
    OAUTH_CODE_TTL: safeParseNumber(process.env.OAUTH_CODE_TTL || base["OAUTH_CODE_TTL"], 600),
    OAUTH_REFRESH_TOKEN_TTL: safeParseNumber(process.env.OAUTH_REFRESH_TOKEN_TTL || base["OAUTH_REFRESH_TOKEN_TTL"], 7776000), // 90 days default
    RADIUS_TIMEOUT: safeParseNumber(process.env.RADIUS_TIMEOUT || base["RADIUS_TIMEOUT"], 5),
    CLASS_MAP: (() => {
      // Accept several simple formats in config.toml for backwards compat:
      // 1) Inline TOML table-like string: CLASS_MAP = { editor_group = [2,3], admin_group = [5] }
      // 2) Our previous array-ish lines: CLASS_MAP = [ "editor_group": 2,3, "admin_group": 5 ]
      // 3) Environment variable as JSON
      const raw = process.env.CLASS_MAP || base["CLASS_MAP"] || ''
      const out: Record<string, number[]> = {}
      const trimmed = raw.trim()
      if (!trimmed) return out

      // Try JSON parse first (allow JSON object string)
      try {
        const j = JSON.parse(trimmed)
        if (typeof j === 'object' && j !== null) {
          for (const k of Object.keys(j)) {
            const v = j[k]
            if (Array.isArray(v)) out[k] = v.map(n => Number(n)).filter(n => !Number.isNaN(n))
            else if (typeof v === 'number') out[k] = [Number(v)]
            else if (typeof v === 'string') out[k] = v.split(/[;,]/).map(s=>Number(s.trim())).filter(n=>!Number.isNaN(n))
          }
          return out
        }
      } catch {
        // fall back to custom parsing
      }

      // Handle TOML inline table { a = [1,2], b = [3] }
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        const inner = trimmed.slice(1, -1)
        // split on commas that follow a closing bracket or number/key; simple split then process
        const parts = inner.split(/,(?=[^\]]*(?:\[|$))/g)
        for (const p of parts) {
          const eq = p.indexOf('=')
          if (eq === -1) continue
          const key = p.slice(0, eq).trim().replace(/^"|"$/g, '')
          const val = p.slice(eq+1).trim()
          let nums: number[] = []
          if (val.startsWith('[') && val.endsWith(']')) {
            const innerArr = val.slice(1, -1)
            nums = innerArr.split(',').map(s=>Number(s.trim())).filter(n=>!Number.isNaN(n))
          } else {
            // single number
            const n = Number(val.replace(/"/g, '').trim())
            if (!Number.isNaN(n)) nums = [n]
          }
          if (key) out[key] = nums
        }
        return out
      }

      // Handle older array-like syntax: "key": 1,2,
      // We'll split tokens by commas and parse quoted keys followed by colon and numbers
      // Remove surrounding [ ] if present
      const simple = (trimmed.startsWith('[') && trimmed.endsWith(']')) ? trimmed.slice(1, -1) : trimmed
      // tokenization: find occurrences of "key": nums
      const keyValRe = /"?([A-Za-z0-9_\-]+)"?\s*[:=]\s*([^,\n]+(?:,[^,\n]+)*)/g
      let m: RegExpExecArray | null
      while ((m = keyValRe.exec(simple)) !== null) {
        const key = m[1]
        const rest = m[2]
        const nums = rest.split(',').map(s=>Number(s.trim())).filter(n=>!Number.isNaN(n))
        if (key) out[key] = nums
      }
      return out
    })(),
  }
  return cfg
}
 
// Dynamic cached config: reload from disk when config.toml (or config.example.toml)
// changes so runtime consumers (imports using `config.*`) pick up updates without
// restarting the server.
let _cachedConfig: Config | null = null
let _cachedMtime = 0

function getConfig(): Config {
  const root = process.cwd()
  const cfgPath = path.join(root, "config.toml")
  const exampleCfgPath = path.join(root, "config.example.toml")
  let watchPath: string | null = null
  
  if (process.env.NODE_ENV === 'test') {
    if (fs.existsSync(exampleCfgPath)) watchPath = exampleCfgPath
  } else {
    if (fs.existsSync(cfgPath)) watchPath = cfgPath
    else if (fs.existsSync(exampleCfgPath)) watchPath = exampleCfgPath
  }

  try {
    if (watchPath) {
      const mtime = fs.statSync(watchPath).mtimeMs || 0
      if (_cachedConfig === null || mtime !== _cachedMtime) {
        _cachedMtime = mtime
        _cachedConfig = loadConfig()
      }
    } else {
      if (_cachedConfig === null) _cachedConfig = loadConfig()
    }
  } catch {
    // On error, fallback to last known config or fresh load
    _cachedConfig = _cachedConfig || loadConfig()
  }
  return _cachedConfig!
}

// Keep the `config` export shape unchanged but back it with a proxy that defers
// to the cached config; callers do `config.X` as before and will see updates
// whenever the config file changes on disk.
export const config: Config = new Proxy({} as Config, {
  get(_, prop: string) {
    const c = getConfig()
    return c[prop as keyof Config]
  }
})

// Test utility to invalidate config cache
export function _invalidateConfigCache() {
  _cachedConfig = null
  _cachedMtime = 0
}

// Install a lightweight filesystem watcher so changes to config.toml (or the
// example file) invalidate the in-memory cache immediately. This provides
// near-real-time config updates without requiring a server restart; the
// mtime-based check in getConfig() remains as a fallback for environments
// where fs.watch isn't reliable.
;(function initConfigWatcher() {
  try {
    const root = process.cwd()
    const cfgPath = path.join(root, "config.toml")
    const exampleCfgPath = path.join(root, "config.example.toml")
    
    let watchPath: string | null = null
    if (process.env.NODE_ENV === 'test') {
      watchPath = fs.existsSync(exampleCfgPath) ? exampleCfgPath : null
    } else {
      watchPath = fs.existsSync(cfgPath) ? cfgPath : (fs.existsSync(exampleCfgPath) ? exampleCfgPath : null)
    }
    
    if (!watchPath) return
    try {
      fs.watch(watchPath, { persistent: false }, () => {
        // Any change/rename reported for the watched file should invalidate
        // the cached config so subsequent accesses reload from disk.
        _cachedMtime = 0
        _cachedConfig = null
      })
    } catch {
      // Ignore watcher setup failures and rely on the mtime-on-access logic.
    }
  } catch {
    // Defensive: never throw during module initialization.
  }
})()
