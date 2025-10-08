#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

// Test the storage abstraction layer (memory and SQLite)
// Simpler version that works with the current CommonJS setup

const fs = require('fs')
const path = require('path')

// Mock config before requiring storage
const _originalEnv = process.env.DATABASE_PATH
const testDir = path.join(__dirname, '..', 'test-data')
const testDbPath = path.join(testDir, `test-${Date.now()}.db`)

// Ensure test directory exists
if (!fs.existsSync(testDir)) {
  fs.mkdirSync(testDir, { recursive: true })
}

console.log('Testing storage layer...')

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

test('Memory storage basic operations', async () => {
  // Clear database path to use memory storage
  delete process.env.DATABASE_PATH
  
  // Clear require cache for storage module
  delete require.cache[require.resolve('../lib/storage.ts')]
  
  const { getStorage } = require('../lib/storage.ts')
  const storage = getStorage()

  const testEntry = {
    username: 'testuser',
    class: 'admin',
    scope: 'openid profile',
    groups: ['admin', 'users'],
    expiresAt: Date.now() + 300000
  }

  // Test set and get
  await storage.set('test-code-1', testEntry)
  const retrieved = await storage.get('test-code-1')
  
  assert(retrieved !== undefined, 'Entry should exist')
  assert(retrieved.username === testEntry.username, 'Username should match')
  assert(retrieved.class === testEntry.class, 'Class should match')
  assert(JSON.stringify(retrieved.groups) === JSON.stringify(testEntry.groups), 'Groups should match')

  // Test delete
  await storage.delete('test-code-1')
  const deleted = await storage.get('test-code-1')
  assert(deleted === undefined, 'Entry should be deleted')
})

test('Memory storage expiration cleanup', async () => {
  delete process.env.DATABASE_PATH
  delete require.cache[require.resolve('../lib/storage.ts')]
  
  const { getStorage } = require('../lib/storage.ts')
  const storage = getStorage()

  // Add expired entry
  const expiredEntry = {
    username: 'expireduser',
    expiresAt: Date.now() - 1000 // 1 second ago
  }

  // Add current entry
  const currentEntry = {
    username: 'currentuser',
    expiresAt: Date.now() + 300000 // 5 minutes from now
  }

  await storage.set('expired-code', expiredEntry)
  await storage.set('current-code', currentEntry)

  // Verify both exist before cleanup
  assert(await storage.get('expired-code') !== undefined, 'Expired entry should exist before cleanup')
  assert(await storage.get('current-code') !== undefined, 'Current entry should exist before cleanup')

  // Run cleanup
  await storage.cleanup()

  // Verify expired entry is gone, current remains
  assert(await storage.get('expired-code') === undefined, 'Expired entry should be cleaned up')
  assert(await storage.get('current-code') !== undefined, 'Current entry should remain after cleanup')
})

test('SQLite storage basic operations', async () => {
  // Set database path for SQLite storage
  process.env.DATABASE_PATH = testDbPath
  delete require.cache[require.resolve('../lib/storage.ts')]
  delete require.cache[require.resolve('../lib/config.ts')]
  
  const { getStorage, closeStorage } = require('../lib/storage.ts')
  
  // Close any existing storage
  await closeStorage().catch(() => {})
  
  const storage = getStorage()

  const testEntry = {
    username: 'testuser-sqlite',
    class: 'editor',
    scope: 'openid profile email',
    groups: ['editor', 'users'],
    expiresAt: Date.now() + 600000
  }

  // Test set and get
  await storage.set('sqlite-test-code-1', testEntry)
  const retrieved = await storage.get('sqlite-test-code-1')
  
  assert(retrieved !== undefined, 'Entry should exist')
  assert(retrieved.username === testEntry.username, 'Username should match')
  assert(retrieved.class === testEntry.class, 'Class should match')
  assert(retrieved.scope === testEntry.scope, 'Scope should match')
  assert(JSON.stringify(retrieved.groups) === JSON.stringify(testEntry.groups), 'Groups should match')
  assert(retrieved.expiresAt === testEntry.expiresAt, 'ExpiresAt should match')

  // Test update (replace)
  const updatedEntry = { ...testEntry, class: 'admin' }
  await storage.set('sqlite-test-code-1', updatedEntry)
  const retrievedUpdated = await storage.get('sqlite-test-code-1')
  assert(retrievedUpdated.class === 'admin', 'Entry should be updated')

  // Test delete
  await storage.delete('sqlite-test-code-1')
  const deleted = await storage.get('sqlite-test-code-1')
  assert(deleted === undefined, 'Entry should be deleted')

  await closeStorage()
})

test('SQLite storage expiration cleanup', async () => {
  process.env.DATABASE_PATH = testDbPath
  delete require.cache[require.resolve('../lib/storage.ts')]
  delete require.cache[require.resolve('../lib/config.ts')]
  
  const { getStorage, closeStorage } = require('../lib/storage.ts')
  await closeStorage().catch(() => {})
  
  const storage = getStorage()

  // Add expired entry
  const expiredEntry = {
    username: 'expireduser-sqlite',
    expiresAt: Date.now() - 5000 // 5 seconds ago
  }

  // Add current entry
  const currentEntry = {
    username: 'currentuser-sqlite',
    expiresAt: Date.now() + 300000 // 5 minutes from now
  }

  await storage.set('expired-sqlite-code', expiredEntry)
  await storage.set('current-sqlite-code', currentEntry)

  // Verify both exist before cleanup
  assert(await storage.get('expired-sqlite-code') !== undefined, 'Expired entry should exist before cleanup')
  assert(await storage.get('current-sqlite-code') !== undefined, 'Current entry should exist before cleanup')

  // Run cleanup
  await storage.cleanup()

  // Verify expired entry is gone, current remains
  assert(await storage.get('expired-sqlite-code') === undefined, 'Expired entry should be cleaned up')
  assert(await storage.get('current-sqlite-code') !== undefined, 'Current entry should remain after cleanup')

  await closeStorage()
})

test('SQLite storage handles null/undefined values', async () => {
  process.env.DATABASE_PATH = testDbPath
  delete require.cache[require.resolve('../lib/storage.ts')]
  delete require.cache[require.resolve('../lib/config.ts')]
  
  const { getStorage, closeStorage } = require('../lib/storage.ts')
  await closeStorage().catch(() => {})
  
  const storage = getStorage()

  const minimalEntry = {
    username: 'minimal-user'
    // All other fields undefined
  }

  await storage.set('minimal-code', minimalEntry)
  const retrieved = await storage.get('minimal-code')
  
  assert(retrieved !== undefined, 'Entry should exist')
  assert(retrieved.username === 'minimal-user', 'Username should match')
  assert(retrieved.class === undefined, 'Class should be undefined')
  assert(retrieved.scope === undefined, 'Scope should be undefined')
  assert(retrieved.groups === undefined, 'Groups should be undefined')
  assert(retrieved.expiresAt === undefined, 'ExpiresAt should be undefined')

  await closeStorage()
})

test('Invalid database path falls back to memory', async () => {
  // Set an invalid database path
  process.env.DATABASE_PATH = '/invalid/path/that/does/not/exist.db'
  delete require.cache[require.resolve('../lib/storage.ts')]
  delete require.cache[require.resolve('../lib/config.ts')]
  
  const { getStorage } = require('../lib/storage.ts')
  const storage = getStorage()

  // Should still work with memory storage fallback
  const testEntry = {
    username: 'fallback-user'
  }

  await storage.set('fallback-code', testEntry)
  const retrieved = await storage.get('fallback-code')
  
  assert(retrieved !== undefined, 'Entry should exist in fallback memory storage')
  assert(retrieved.username === 'fallback-user', 'Username should match in fallback storage')
})

// Run tests
runTests().then(() => {
  // Cleanup
  try {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath)
    }
    if (fs.existsSync(testDir) && fs.readdirSync(testDir).length === 0) {
      fs.rmdirSync(testDir)
    }
  } catch {
    // Ignore cleanup errors
  }

  // Restore original environment (unused in test run but kept for completeness)
  if (_originalEnv !== undefined) {
    process.env.DATABASE_PATH = _originalEnv
  } else {
    delete process.env.DATABASE_PATH
  }

  console.log(`\nStorage tests completed: ${passed} passed, ${failed} failed`)
  
  if (failed > 0) {
    process.exit(1)
  }
}).catch(err => {
  console.error('Test runner error:', err)
  process.exit(1)
})