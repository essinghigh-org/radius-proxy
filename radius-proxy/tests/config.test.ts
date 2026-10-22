import { expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const modulePath = path.resolve(import.meta.dir, '../lib/config.ts')
test('configuration reload keeps the last valid values after an invalid save', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'radius-config-test-'))
  try {
    fs.writeFileSync(path.join(root, 'package.json'), '{}')
    const program = `
      import fs from 'node:fs'
      const initial = 'ISSUER = "https://auth.example.com"\\nEMAIL_SUFFIX = "first.example"'
      fs.writeFileSync('config.toml', initial)
      const { config } = await import(${JSON.stringify(modulePath)})
      if (config.EMAIL_SUFFIX !== 'first.example') throw new Error('Initial config not read')
      fs.writeFileSync('config.toml', 'ISSUER = "javascript:invalid"')
      await Bun.sleep(30)
      if (config.EMAIL_SUFFIX !== 'first.example') throw new Error('Lost last valid configuration')
      fs.writeFileSync('config.toml', 'ISSUER = "https://auth.example.com"\\nEMAIL_SUFFIX = "second.example"')
      await Bun.sleep(30)
      if (config.EMAIL_SUFFIX !== 'second.example') throw new Error('Valid reload failed')
      console.log('ok')
    `
    const result = Bun.spawnSync([process.execPath, '--eval', program], {
      cwd: root,
      env: { NODE_ENV: 'production', OAUTH_CLIENT_SECRET: 'test-client-secret-with-at-least-32-characters', RADIUS_SECRET: 'test-radius-shared-secret', REDIRECT_URIS: 'https://grafana.example.com/login/generic_oauth' },
    })
    expect(result.stderr.toString()).toContain('[config] reload rejected; keeping the last valid configuration')
    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString().trim()).toBe('ok')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('production configuration does not fall back to example credentials', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'radius-example-test-'))
  try {
    fs.writeFileSync(path.join(root, 'package.json'), '{}')
    fs.writeFileSync(path.join(root, 'config.example.toml'), 'OAUTH_CLIENT_SECRET = "sample-secret-of-at-least-32-characters"\nRADIUS_SECRET = "sample-radius-secret"\nISSUER = "https://auth.example.com"\nREDIRECT_URIS = ["https://grafana.example.com/login/generic_oauth"]')
    const result = Bun.spawnSync([process.execPath, '--eval', `const { config } = await import(${JSON.stringify(modulePath)}); console.log(config.ISSUER)`], { cwd: root, env: { NODE_ENV: 'production' } })
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain('OAUTH_CLIENT_SECRET must be explicitly configured')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
