export const DEBUG_ENABLED = Boolean(process.env.DEBUG) || process.env.NODE_ENV !== "production"

export function debug(...args: unknown[]) {
  if (DEBUG_ENABLED) console.debug("[radius-proxy][debug]", ...args)
}

export function info(...args: unknown[]) {
  if (DEBUG_ENABLED) console.info("[radius-proxy][info]", ...args)
}

export function warn(...args: unknown[]) {
  if (DEBUG_ENABLED) console.warn("[radius-proxy][warn]", ...args)
}

export function error(...args: unknown[]) {
  // Always surface errors so unexpected failures are visible in production
  console.error("[radius-proxy][error]", ...args)
}