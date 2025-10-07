import { config } from './config'

export function isClassPermitted(classAttr?: string): boolean {
  const allowed = config.PERMITTED_CLASSES
  if (!allowed.length) return true // no restrictions configured
  if (!classAttr) return false
  // Split classAttr if multiple classes were encoded with delimiters
  const tokens = classAttr.split(/[;,]/).map(s=>s.trim()).filter(Boolean)
  return tokens.some(t => allowed.includes(t))
}
