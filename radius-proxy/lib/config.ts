import fs from "fs"
import path from "path"

type Config = {
  OAUTH_CLIENT_ID: string
  OAUTH_CLIENT_SECRET: string
  RADIUS_HOST: string
  RADIUS_SECRET: string
  HOSTNAME: string
  HTTP_PORT: number
  ISSUER?: string
  EMAIL_SUFFIX: string
  PERMITTED_CLASSES: string[]
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
    HOSTNAME: process.env.HOSTNAME || base["HOSTNAME"] || "0.0.0.0",
    HTTP_PORT: Number(process.env.HTTP_PORT || base["HTTP_PORT"] || 3000),
    ISSUER: process.env.ISSUER || base["ISSUER"],
    EMAIL_SUFFIX: process.env.EMAIL_SUFFIX || base["EMAIL_SUFFIX"] || base["EMAIL_DOMAIN"] || 'example.local',
    PERMITTED_CLASSES: (process.env.PERMITTED_CLASSES || base["PERMITTED_CLASSES"] || '')
      .split(',')
      .map(s=>s.trim())
      .filter(Boolean),
    REDIRECT_URIS: (process.env.REDIRECT_URIS || base["REDIRECT_URIS"] || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    OAUTH_CODE_TTL: Number(process.env.OAUTH_CODE_TTL || base["OAUTH_CODE_TTL"] || 300),
  }
  return cfg
}

export const config = loadConfig()
