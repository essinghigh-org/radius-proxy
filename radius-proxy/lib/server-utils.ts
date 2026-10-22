import { config } from "./config"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

// Server-side helper to derive the issuer/origin for requests. Kept out of
// `lib/utils.ts` so client bundles don't accidentally pull in server-only
// dependencies like `fs` via `lib/config` imports.
export function getIssuer(_req?: Request | string): string {
  // Never derive a trust boundary from caller-supplied Host or forwarding headers.
  return config.ISSUER || `http://localhost:${config.HTTP_PORT}`
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
