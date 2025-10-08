#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

// Test refresh token functionality
// Simpler version that works with the current CommonJS setup

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

// Mock config before requiring storage
// original DATABASE_PATH not needed; using memory storage
const testDir = path.join(__dirname, '..', 'test-data')
const testDbPath = path.join(testDir, `test-refresh-${Date.now()}.db`)

// Ensure test directory exists
if (!fs.existsSync(testDir)) {
  fs.mkdirSync(testDir, { recursive: true })
}

console.log('Testing refresh token functionality...')

let tests = []

function test(name, fn) {
  tests.push({ name, fn })
}

function expect(actual) {
  return {
    toBe: (expected) => {
      if (actual !== expected) {
        throw new Error(`Expected ${expected}, got ${actual}`)
      }
    },
    toEqual: (expected) => {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
      }
    },
    toBeUndefined: () => {
      if (actual !== undefined) {
        throw new Error(`Expected undefined, got ${actual}`)
      }
    },
    toBeDefined: () => {
      if (actual === undefined) {
        throw new Error('Expected value to be defined')
      }
    },
    toContain: (expected) => {
      if (!Array.isArray(actual) || !actual.includes(expected)) {
        throw new Error(`Expected array to contain ${expected}`)
      }
    }
  }
}

async function runTests() {
  let passed = 0
  let failed = 0

  for (const { name, fn } of tests) {
    try {
      await fn()
      console.log(`✓ ${name}`)
      passed++
    } catch (err) {
      console.log(`✗ ${name}: ${err.message}`)
      failed++
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`)
  
  // Cleanup
  try {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath)
    }
  } catch (err) {
    console.warn('Cleanup warning:', err.message)
  }
  
  process.exit(failed > 0 ? 1 : 0)
}

// Set up test environment - force memory storage to avoid SQLite compatibility issues
delete process.env.DATABASE_PATH

// Import after setting up environment
const { getStorage } = require('../lib/storage')

test('should store and retrieve refresh token', async () => {
  const storage = getStorage()
  const token = crypto.randomBytes(32).toString('base64url')
  const entry = {
    username: 'testuser',
    class: 'admin_group',
    scope: 'openid profile',
    groups: ['admin_group', 'editor_group'],
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
    clientId: 'grafana'
  }

  await storage.setRefreshToken(token, entry)
  const retrieved = await storage.getRefreshToken(token)

  expect(retrieved).toEqual(entry)
})

test('should return undefined for non-existent refresh token', async () => {
  const storage = getStorage()
  const token = crypto.randomBytes(32).toString('base64url')
  const retrieved = await storage.getRefreshToken(token)
  expect(retrieved).toBeUndefined()
})

test('should delete refresh token', async () => {
  const storage = getStorage()
  const token = crypto.randomBytes(32).toString('base64url')
  const entry = {
    username: 'testuser',
    class: 'admin_group',
    scope: 'openid profile',
    groups: ['admin_group'],
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    clientId: 'grafana'
  }

  await storage.setRefreshToken(token, entry)
  await storage.deleteRefreshToken(token)
  const retrieved = await storage.getRefreshToken(token)

  expect(retrieved).toBeUndefined()
})

test('should cleanup expired refresh tokens', async () => {
  const storage = getStorage()
  const token1 = crypto.randomBytes(32).toString('base64url')
  const token2 = crypto.randomBytes(32).toString('base64url')
  
  const expiredEntry = {
    username: 'testuser1',
    class: 'admin_group',
    scope: 'openid profile',
    groups: ['admin_group'],
    expiresAt: Date.now() - 1000, // Expired 1 second ago
    clientId: 'grafana'
  }
  
  const validEntry = {
    username: 'testuser2',
    class: 'admin_group',
    scope: 'openid profile',
    groups: ['admin_group'],
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // Valid for 30 days
    clientId: 'grafana'
  }

  await storage.setRefreshToken(token1, expiredEntry)
  await storage.setRefreshToken(token2, validEntry)

  // Run cleanup
  await storage.cleanupRefreshTokens()

  // Expired token should be gone
  const retrieved1 = await storage.getRefreshToken(token1)
  expect(retrieved1).toBeUndefined()

  // Valid token should still exist
  const retrieved2 = await storage.getRefreshToken(token2)
  expect(retrieved2).toEqual(validEntry)
})

test('should work with memory storage', async () => {
  // Test with memory storage by unsetting DATABASE_PATH temporarily
  const originalDbPath = process.env.DATABASE_PATH
  delete process.env.DATABASE_PATH
  
  // This will create a new memory storage instance
  const { getStorage: getMemoryStorage } = require('../lib/storage')
  const storage = getMemoryStorage()
  
  const token = crypto.randomBytes(32).toString('base64url')
  const entry = {
    username: 'memoryuser',
    class: 'test_group',
    scope: 'openid profile',
    groups: ['test_group'],
    expiresAt: Date.now() + 1000,
    clientId: 'grafana'
  }

  await storage.setRefreshToken(token, entry)
  const retrieved = await storage.getRefreshToken(token)
  expect(retrieved).toEqual(entry)
  
  // Restore DATABASE_PATH
  process.env.DATABASE_PATH = originalDbPath
})

// Run the tests
runTests().catch(err => {
  console.error('Test runner error:', err)
  process.exit(1)
})