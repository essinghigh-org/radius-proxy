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
  EMAIL_SUFFIX: string
  PERMITTED_CLASSES: string[]
  ADMIN_CLASSES: string[]
  // Optional explicit list of allowed redirect URIs for the OAuth client.
  // If empty, only same-origin redirects are allowed.
  REDIRECT_URIS: string[]
  // OAuth authorization code time-to-live (seconds)
  OAUTH_CODE_TTL: number
}

function parseTomlSimple(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    // strip quotes
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1)
    out[key] = val
  }
  return out
}

function loadConfig(): Config {
  const root = process.cwd()
  const cfgPath = path.join(root, "config.toml")
  const exampleCfgPath = path.join(root, "config.example.toml")
  let base: Record<string, string> = {}
  // Prefer explicit config.toml but fall back to config.example.toml if present (useful for examples)
  let cfgFile = ""
  if (fs.existsSync(cfgPath)) {
    cfgFile = cfgPath
  } else if (fs.existsSync(exampleCfgPath)) {
    cfgFile = exampleCfgPath
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
    RADIUS_PORT: Number(process.env.RADIUS_PORT || base["RADIUS_PORT"] || 1812),
    HTTP_HOST: process.env.HTTP_HOST || base["HTTP_HOST"] || "0.0.0.0",
    HTTP_PORT: Number(process.env.HTTP_PORT || base["HTTP_PORT"] || 3000),
    ISSUER: process.env.ISSUER || base["ISSUER"],
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
    OAUTH_CODE_TTL: Number(process.env.OAUTH_CODE_TTL || base["OAUTH_CODE_TTL"] || 300),
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
  if (fs.existsSync(cfgPath)) watchPath = cfgPath
  else if (fs.existsSync(exampleCfgPath)) watchPath = exampleCfgPath

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
  } catch (e) {
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
    return (c as any)[prop]
  }
})

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
    const watchPath = fs.existsSync(cfgPath) ? cfgPath : (fs.existsSync(exampleCfgPath) ? exampleCfgPath : null)
    if (!watchPath) return
    try {
      fs.watch(watchPath, { persistent: false }, (eventType) => {
        // Any change/rename reported for the watched file should invalidate
        // the cached config so subsequent accesses reload from disk.
        _cachedMtime = 0
        _cachedConfig = null
      })
    } catch (e) {
      // Ignore watcher setup failures and rely on the mtime-on-access logic.
    }
  } catch (e) {
    // Defensive: never throw during module initialization.
  }
})()
