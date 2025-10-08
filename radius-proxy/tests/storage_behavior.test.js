#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

// Test the storage abstraction layer (memory only)
// Simplified version that only tests memory storage

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

test('Memory storage refresh tokens', async () => {
  delete require.cache[require.resolve('../lib/storage.ts')]
  
  const { getStorage } = require('../lib/storage.ts')
  const storage = getStorage()

  const testEntry = {
    username: 'testuser',
    class: 'admin',
    scope: 'openid profile',
    groups: ['admin', 'users'],
    expiresAt: Date.now() + 300000,
    clientId: 'test-client'
  }

  // Test refresh token operations
  await storage.setRefreshToken('test-refresh-token', testEntry)
  const retrieved = await storage.getRefreshToken('test-refresh-token')
  
  assert(retrieved !== undefined, 'Refresh token should exist')
  assert(retrieved.username === testEntry.username, 'Username should match')
  assert(retrieved.clientId === testEntry.clientId, 'Client ID should match')

  // Test delete refresh token
  await storage.deleteRefreshToken('test-refresh-token')
  const deleted = await storage.getRefreshToken('test-refresh-token')
  assert(deleted === undefined, 'Refresh token should be deleted')
})

test('Memory storage handles null/undefined values', async () => {
  delete require.cache[require.resolve('../lib/storage.ts')]
  
  const { getStorage } = require('../lib/storage.ts')
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
})

// Run tests
runTests().then(() => {
  console.log(`\nStorage tests completed: ${passed} passed, ${failed} failed`)
  
  if (failed > 0) {
    process.exit(1)
  }
}).catch(err => {
  console.error('Test runner error:', err)
  process.exit(1)
})