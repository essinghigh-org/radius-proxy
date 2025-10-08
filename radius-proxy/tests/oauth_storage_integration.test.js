#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

// OAuth integration test with storage backends
// Tests the full authorize -> token flow with both memory and SQLite storage

const fs = require('fs')
const path = require('path')

console.log('Testing OAuth flow with different storage backends...')

// Mock configuration for testing
const mockConfig = {
  OAUTH_CLIENT_ID: 'test-client',
  OAUTH_CLIENT_SECRET: 'test-secret',
  OAUTH_CODE_TTL: 300,
  EMAIL_SUFFIX: 'test.local',
  ADMIN_CLASSES: ['admin'],
  CLASS_MAP: { admin: [1, 2], editor: [3] }
}

// Mock the config module
function mockConfigModule() {
  const originalConfig = require('../lib/config.ts')
  for (const [key, value] of Object.entries(mockConfig)) {
    originalConfig.config[key] = value
  }
}

let tests = []
let passed = 0
let failed = 0

function test(name, fn) {
  tests.push({ name, fn })
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed')
  }
}

async function runTests() {
  for (const { name, fn } of tests) {
    try {
      console.log(`  Running: ${name}`)
      await fn()
      console.log(`  ✓ ${name}`)
      passed++
    } catch (err) {
      console.log(`  ✗ ${name}: ${err.message}`)
      failed++
    }
  }
}

test('OAuth flow with memory storage', async () => {
  // Set up memory storage
  delete process.env.DATABASE_PATH
  delete require.cache[require.resolve('../lib/storage.ts')]
  delete require.cache[require.resolve('../lib/config.ts')]
  
  mockConfigModule()
  const { getStorage } = require('../lib/storage.ts')
  const storage = getStorage()

  // Test storing an OAuth code (simulating authorize endpoint)
  const code = 'test-auth-code-memory'
  const entry = {
    username: 'testuser',
    class: 'admin,editor',
    scope: 'openid profile',
    groups: ['admin', 'editor'],
    expiresAt: Date.now() + 300000
  }

  await storage.set(code, entry)

  // Test retrieving the code (simulating token endpoint)
  const retrieved = await storage.get(code)
  assert(retrieved !== undefined, 'OAuth code should be retrievable')
  assert(retrieved.username === entry.username, 'Username should match')
  assert(JSON.stringify(retrieved.groups) === JSON.stringify(entry.groups), 'Groups should match')

  // Test code consumption (one-time use)
  await storage.delete(code)
  const afterDelete = await storage.get(code)
  assert(afterDelete === undefined, 'OAuth code should be deleted after use')
})

test('OAuth flow with SQLite storage', async () => {
  // Set up SQLite storage
  const testDir = path.join(__dirname, '..', 'test-data')
  const testDbPath = path.join(testDir, `oauth-test-${Date.now()}.db`)
  
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true })
  }

  process.env.DATABASE_PATH = testDbPath
  delete require.cache[require.resolve('../lib/storage.ts')]
  delete require.cache[require.resolve('../lib/config.ts')]
  
  mockConfigModule()
  const { getStorage, closeStorage } = require('../lib/storage.ts')
  
  // Close any existing storage
  await closeStorage().catch(() => {})
  
  const storage = getStorage()

  // Test storing an OAuth code (simulating authorize endpoint)
  const code = 'test-auth-code-sqlite'
  const entry = {
    username: 'testuser-sqlite',
    class: 'editor',
    scope: 'openid profile email',
    groups: ['editor', 'users'],
    expiresAt: Date.now() + 600000
  }

  await storage.set(code, entry)

  // Test retrieving the code (simulating token endpoint)
  const retrieved = await storage.get(code)
  assert(retrieved !== undefined, 'OAuth code should be retrievable')
  assert(retrieved.username === entry.username, 'Username should match')
  assert(retrieved.class === entry.class, 'Class should match')
  assert(retrieved.scope === entry.scope, 'Scope should match')
  assert(JSON.stringify(retrieved.groups) === JSON.stringify(entry.groups), 'Groups should match')

  // Test code consumption (one-time use)
  await storage.delete(code)
  const afterDelete = await storage.get(code)
  assert(afterDelete === undefined, 'OAuth code should be deleted after use')

  await closeStorage()

  // Cleanup
  try {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath)
    }
  } catch {
    // Ignore cleanup errors
  }
})

test('OAuth code expiration handling', async () => {
  delete process.env.DATABASE_PATH
  delete require.cache[require.resolve('../lib/storage.ts')]
  delete require.cache[require.resolve('../lib/config.ts')]
  
  mockConfigModule()
  const { getStorage } = require('../lib/storage.ts')
  const storage = getStorage()

  // Create an already-expired code
  const expiredCode = 'expired-oauth-code'
  const expiredEntry = {
    username: 'expireduser',
    expiresAt: Date.now() - 10000 // 10 seconds ago
  }

  await storage.set(expiredCode, expiredEntry)

  // Simulate token endpoint checking expiration
  const retrieved = await storage.get(expiredCode)
  assert(retrieved !== undefined, 'Expired code should still be in storage before cleanup')

  // Check if code is expired (token endpoint logic)
  const isExpired = retrieved.expiresAt && Date.now() > retrieved.expiresAt
  assert(isExpired === true, 'Code should be detected as expired')

  // Token endpoint should delete expired codes
  if (isExpired) {
    await storage.delete(expiredCode)
  }

  const afterExpiredDelete = await storage.get(expiredCode)
  assert(afterExpiredDelete === undefined, 'Expired code should be deleted')
})

test('Multiple concurrent OAuth codes', async () => {
  delete process.env.DATABASE_PATH
  delete require.cache[require.resolve('../lib/storage.ts')]
  delete require.cache[require.resolve('../lib/config.ts')]
  
  mockConfigModule()
  const { getStorage } = require('../lib/storage.ts')
  const storage = getStorage()

  // Simulate multiple users getting OAuth codes simultaneously
  const codes = []
  const entries = []

  for (let i = 0; i < 5; i++) {
    const code = `concurrent-code-${i}`
    const entry = {
      username: `user${i}`,
      class: i % 2 === 0 ? 'admin' : 'editor',
      groups: i % 2 === 0 ? ['admin'] : ['editor'],
      expiresAt: Date.now() + 300000
    }
    
    codes.push(code)
    entries.push(entry)
    await storage.set(code, entry)
  }

  // Verify all codes can be retrieved independently
  for (let i = 0; i < 5; i++) {
    const retrieved = await storage.get(codes[i])
    assert(retrieved !== undefined, `Code ${i} should be retrievable`)
    assert(retrieved.username === entries[i].username, `Username for code ${i} should match`)
  }

  // Simulate token exchange for some codes (not all)
  await storage.delete(codes[0])
  await storage.delete(codes[2])
  await storage.delete(codes[4])

  // Verify remaining codes still exist
  assert(await storage.get(codes[0]) === undefined, 'Code 0 should be deleted')
  assert(await storage.get(codes[1]) !== undefined, 'Code 1 should still exist')
  assert(await storage.get(codes[2]) === undefined, 'Code 2 should be deleted')
  assert(await storage.get(codes[3]) !== undefined, 'Code 3 should still exist')
  assert(await storage.get(codes[4]) === undefined, 'Code 4 should be deleted')
})

test('Storage backend consistency between memory and SQLite', async () => {
  // Test the same operations on both backends to ensure consistent behavior
  
  const testOperations = async (storage, label) => {
    const testEntry = {
      username: `consistency-user-${label}`,
      class: 'test-class',
      scope: 'openid profile',
      groups: ['test', 'groups'],
      expiresAt: Date.now() + 300000
    }

    // Test basic operations
    await storage.set('consistency-code', testEntry)
    const retrieved = await storage.get('consistency-code')
    
    assert(retrieved !== undefined, `${label}: Entry should exist`)
    assert(retrieved.username === testEntry.username, `${label}: Username should match`)
    assert(JSON.stringify(retrieved.groups) === JSON.stringify(testEntry.groups), `${label}: Groups should match`)

    // Test overwrite
    const updatedEntry = { ...testEntry, class: 'updated-class' }
    await storage.set('consistency-code', updatedEntry)
    const afterUpdate = await storage.get('consistency-code')
    assert(afterUpdate.class === 'updated-class', `${label}: Entry should be updated`)

    // Test deletion
    await storage.delete('consistency-code')
    const afterDelete = await storage.get('consistency-code')
    assert(afterDelete === undefined, `${label}: Entry should be deleted`)

    return true
  }

  // Test memory storage
  delete process.env.DATABASE_PATH
  delete require.cache[require.resolve('../lib/storage.ts')]
  delete require.cache[require.resolve('../lib/config.ts')]
  
  mockConfigModule()
  const { getStorage: getMemoryStorage } = require('../lib/storage.ts')
  const memoryStorage = getMemoryStorage()
  await testOperations(memoryStorage, 'Memory')

  // Test SQLite storage
  const testDir = path.join(__dirname, '..', 'test-data')
  const testDbPath = path.join(testDir, `consistency-test-${Date.now()}.db`)
  
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true })
  }

  process.env.DATABASE_PATH = testDbPath
  delete require.cache[require.resolve('../lib/storage.ts')]
  delete require.cache[require.resolve('../lib/config.ts')]
  
  mockConfigModule()
  const { getStorage: getSqliteStorage, closeStorage } = require('../lib/storage.ts')
  await closeStorage().catch(() => {})
  
  const sqliteStorage = getSqliteStorage()
  await testOperations(sqliteStorage, 'SQLite')

  await closeStorage()

  // Cleanup
  try {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath)
    }
  } catch {
    // Ignore cleanup errors
  }
})

// Run tests
runTests().then(() => {
  console.log(`\nOAuth integration tests completed: ${passed} passed, ${failed} failed`)
  
  if (failed > 0) {
    process.exit(1)
  }
}).catch(err => {
  console.error('Test runner error:', err)
  process.exit(1)
})