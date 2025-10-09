import fs from 'fs'
import path from 'path'

// Consider the runtime development mode: file logging and verbose console output
// should be enabled in development, but disabled for the built/production app.
export const DEBUG_ENABLED = Boolean(process.env.DEBUG) || process.env.NODE_ENV !== 'production'
const IS_DEV = process.env.NODE_ENV !== 'production'

const LOG_DIR = path.join(process.cwd(), '.logs')
// Use debug.log for verbose development logs
const LOG_FILE = path.join(LOG_DIR, 'debug.log')
// Legacy filename that older versions used; we'll remove it on dev startup.
const LEGACY_LOG_FILE = path.join(LOG_DIR, 'radius-proxy.log')

// File logging is enabled only in development by default. You can override
// by setting FORCE_FILE_LOGS=1 in the env (useful for CI/debugging).
const FILE_LOGGING = IS_DEV || Boolean(process.env.FORCE_FILE_LOGS)

// If file logging is enabled, suppress noisy radius-proxy info/debug console
// output in the terminal. We wrap console.info/console.debug so other libs
// still log normally, but logs originating from this project (prefixed
// '[radius-proxy]') are kept out of the terminal and only written to file.
if (FILE_LOGGING) {
  try {
    const _origInfo = console.info.bind(console)
    const _origDebug = (console.debug || console.log).bind(console)
    const _origLog = console.log.bind(console)

    const containsPrefix = (a: unknown[]) => {
      try {
        for (const v of a) {
          if (typeof v === 'string' && v.includes('[radius-proxy]')) return true
          try {
            const s = JSON.stringify(v)
            if (typeof s === 'string' && s.includes('[radius-proxy]')) return true
          } catch {
            // ignore stringify errors
          }
        }
      } catch {
        // ignore
      }
      return false
    }

    console.info = (...a: unknown[]) => {
      if (containsPrefix(a)) return
      return _origInfo(...a)
    }
    console.debug = (...a: unknown[]) => {
      if (containsPrefix(a)) return
      return _origDebug(...a)
    }
    console.log = (...a: unknown[]) => {
      if (containsPrefix(a)) return
      return _origLog(...a)
    }
  } catch {
    // best-effort; don't crash on consoles we can't wrap
  }
}

// On development startup, clear previous logs so each `bun dev` run starts fresh.
if (FILE_LOGGING && IS_DEV) {
  try {
    ensureLogDir()
    // Truncate or create the current debug file
    try {
      fs.writeFileSync(LOG_FILE, '')
    } catch {
      // ignore
    }
    // Remove legacy file if present to avoid confusion
    try {
      if (fs.existsSync(LEGACY_LOG_FILE) && LEGACY_LOG_FILE !== LOG_FILE) {
        fs.unlinkSync(LEGACY_LOG_FILE)
      }
    } catch {
      // ignore
    }
  } catch {
    // ignore
  }
}

function ensureLogDir() {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true })
  } catch {
    // ignore
  }
}

function serializeStructured(a: unknown): unknown {
  try {
    if (typeof a === 'string') return a
    if (typeof a === 'number' || typeof a === 'boolean' || a === null) return a
    if (a instanceof Error) return { message: a.message, stack: a.stack }
    // If it's already a plain object/array, try to return it as-is (structured)
    if (typeof a === 'object') return a
    // Fallback to string representation
    return String(a)
  } catch {
    try {
      return String(a)
    } catch {
      return '[unserializable]'
    }
  }
}

// Create a compact string representation used for console dedupe comparisons
function serializeCompact(a: unknown): string {
  try {
    if (typeof a === 'string') return a
    if (typeof a === 'number' || typeof a === 'boolean' || a === null) return String(a)
    if (a instanceof Error) return a.message
    try { return JSON.stringify(a) } catch { return String(a) }
  } catch {
    try { return String(a) } catch { return '[unserializable]' }
  }
}

function appendLog(level: string, args: unknown[]) {
  if (!FILE_LOGGING) return
  try {
    ensureLogDir()
    const compactMessage = args
      .map(a => (typeof a === 'string' ? a : (() => {
        try { return JSON.stringify(a) } catch { return String(a) }
      })()))
      .join(' ')

    const entry = {
      ts: new Date().toISOString(),
      pid: process.pid,
      level,
      message: compactMessage,
      args: args.map(serializeStructured),
      cwd: process.cwd()
    }
  // Write pretty-printed JSON blocks separated by a blank line so the
  // logfile is easy to read during development. Keep one JSON object per
  // event (multi-line) to help manual inspection.
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry, null, 2) + '\n\n')
  } catch {
    // ignore logging failures; we must never crash the app for logging
  }
}

// Minimal log level control: error=0, warn=1, info=2, debug=3
const LEVELS: Record<string, number> = { error: 0, warn: 1, info: 2, debug: 3 }
const DEFAULT_LEVEL = IS_DEV ? 'debug' : 'info'
const LOG_LEVEL = (process.env.LOG_LEVEL || DEFAULT_LEVEL).toLowerCase()
const LOG_LEVEL_NUM = LEVELS[LOG_LEVEL] ?? LEVELS[DEFAULT_LEVEL]

// Suppress repeated console messages by coalescing identical consecutive messages.
// We still write every event to the file in development.
let lastConsoleMessage = ''
let lastConsoleLevel = ''
let lastConsoleCount = 0

function flushLastConsoleRepeat() {
  if (lastConsoleCount > 1) {
    // Replay a short summary of the repeated message. Only print summaries
    // for warnings/errors to the console when file logging is enabled. If
    // file logging is active we keep verbose summaries out of the terminal
    // (they're available in the debug log).
    if (!FILE_LOGGING || lastConsoleLevel === 'warn' || lastConsoleLevel === 'error') {
      console.info(
        `[radius-proxy][${lastConsoleLevel}] (repeated ${lastConsoleCount}x)`,
        lastConsoleMessage
      )
    }
    lastConsoleCount = 0
  }
}

function consoleWrite(level: string, prefix: string, args: unknown[]) {
  // Prepare a compact string for dedup comparison (not for file)
  const compact = args.map(a => serializeCompact(a)).join(' ')

  // If same as last message, just increment counter and don't spam console
  if (compact === lastConsoleMessage && level === lastConsoleLevel) {
    lastConsoleCount++
    return
  }

  // If there was a repeated previous message, flush a summary before printing new
  flushLastConsoleRepeat()

  // Print a compact single-line summary to console if level permits.
  // If file logging is enabled we suppress 'info' and 'debug' console
  // output to avoid duplicating verbose entries that are already stored
  // in the debug log. Warnings and errors still surface to the terminal.
  const shouldPrintToConsole = (LEVELS[level] ?? 0) <= LOG_LEVEL_NUM &&
    (!(FILE_LOGGING && (level === 'info' || level === 'debug')))

  if (shouldPrintToConsole) {
    if (level === 'debug') console.debug(prefix, compact)
    else if (level === 'info') console.info(prefix, compact)
    else if (level === 'warn') console.warn(prefix, compact)
    else if (level === 'error') console.error(prefix, compact)
    else console.info(prefix, compact)
  }

  // Track last message for deduping
  lastConsoleMessage = compact
  lastConsoleLevel = level
  lastConsoleCount = 1
}

export function debug(...args: unknown[]) {
  if (!DEBUG_ENABLED) return
  consoleWrite('debug', '[radius-proxy][debug]', args)
  appendLog('debug', args)
}

export function info(...args: unknown[]) {
  consoleWrite('info', '[radius-proxy][info]', args)
  appendLog('info', args)
}

export function warn(...args: unknown[]) {
  consoleWrite('warn', '[radius-proxy][warn]', args)
  appendLog('warn', args)
}

export function error(...args: unknown[]) {
  // Always surface errors to console regardless of LOG_LEVEL
  // Flush any repeated summary first so errors are visible in context
  flushLastConsoleRepeat()
  console.error('[radius-proxy][error]', ...args)
  appendLog('error', args)
}
