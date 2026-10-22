const files = [...new Bun.Glob("tests/*.test.ts").scanSync()].sort()
if (files.length === 0) { console.error("No test files found"); process.exit(1) }
for (const file of files) {
  const result = Bun.spawnSync([process.execPath, "test", file], { stdout: "inherit", stderr: "inherit", env: { ...process.env, NODE_ENV: "test", OAUTH_CLIENT_SECRET: "secret", RADIUS_SECRET: "test-only-radius-secret" } })
  if (result.exitCode !== 0) process.exit(result.exitCode || 1)
}
