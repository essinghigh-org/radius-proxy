import clsx, { type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(...inputs))
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
