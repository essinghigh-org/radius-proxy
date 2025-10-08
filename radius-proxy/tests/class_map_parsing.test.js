import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'

// Read config.example.toml from repo and extract CLASS_MAP value for parsing
const examplePath = path.join(process.cwd(), 'config.example.toml')
const content = fs.readFileSync(examplePath, 'utf8')

// Minimal extraction: find the CLASS_MAP = ... line and capture value (supporting inline table or multi-line)
function extractClassMapRaw(toml) {
	const lines = toml.split(/\r?\n/)
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim()
		if (!line.startsWith('CLASS_MAP')) continue
		const eq = line.indexOf('=')
		if (eq === -1) continue
		let val = line.slice(eq+1).trim()
		if ((val.startsWith('{') && !val.endsWith('}')) || (val.startsWith('[') && !val.endsWith(']'))) {
			// accumulate until closing bracket
			// note: delimiter tracking not needed for current simple depth logic
			// determine matching closing delimiter implicitly via depth counting
			let acc = val
			let depth = (acc.match(/[\[{]/g) || []).length - (acc.match(/[\]}]/g) || []).length
			while (depth > 0 && i + 1 < lines.length) {
				i++
				acc += '\n' + lines[i]
				depth = (acc.match(/[\[{]/g) || []).length - (acc.match(/[\]}]/g) || []).length
			}
			val = acc.trim()
		}
		return val
	}
	return ''
}

function parseClassMapRaw(raw) {
	const out = {}
	const trimmed = raw.trim()
	if (!trimmed) return out
	// Handle inline table { a = [1,2], b = [3] }
	if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
		const inner = trimmed.slice(1, -1)
		const parts = inner.split(/,(?=[^\]]*(?:\[|$))/g)
		for (const p of parts) {
			const eq = p.indexOf('=')
			if (eq === -1) continue
			const key = p.slice(0, eq).trim().replace(/^"|"$/g, '')
			const val = p.slice(eq+1).trim()
			let nums = []
			if (val.startsWith('[') && val.endsWith(']')) {
				nums = val.slice(1, -1).split(',').map(s=>Number(s.trim())).filter(n=>!Number.isNaN(n))
			} else {
				const n = Number(val.replace(/"/g, '').trim())
				if (!Number.isNaN(n)) nums = [n]
			}
			if (key) out[key] = nums
		}
		return out
	}
	return out
}

const raw = extractClassMapRaw(content)
assert.ok(raw, 'CLASS_MAP not found in config.example.toml')
const parsed = parseClassMapRaw(raw)
assert.ok(parsed['editor_group'] && Array.isArray(parsed['editor_group']))
assert.ok(parsed['admin_group'] && Array.isArray(parsed['admin_group']))

console.log('class_map parsing test passed')
