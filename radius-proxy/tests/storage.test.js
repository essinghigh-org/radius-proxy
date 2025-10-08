#!/usr/bin/env node

// Test the storage abstraction layer (memory and SQLite)

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// Mock config for testing
const mockConfig = {
  DATABASE_PATH: undefined, // Will be set per test
}

// Mock the config module
const mockConfigModule = {
  config: new Proxy(mockConfig, {
    get(target, prop) {
      return target[prop]
    }
  })
}

// Mock logger
const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {}
}

// Dynamic imports to allow mocking
async function createStorageTest() {
  // Create a temporary directory for test databases
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const testDir = path.join(__dirname, '..', 'test-data')
  
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true })
  }

  const testDbPath = path.join(testDir, `test-${Date.now()}.db`)

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

  // Test memory storage
  test('Memory storage basic operations', async () => {
    mockConfig.DATABASE_PATH = undefined
    
    // Import storage module after setting mock config
    const storageModule = await import('../lib/storage.js')
    const storage = storageModule.getStorage()

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
    mockConfig.DATABASE_PATH = undefined
    
    const storageModule = await import('../lib/storage.js')
    const storage = storageModule.getStorage()

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
    mockConfig.DATABASE_PATH = testDbPath
    
    // Force re-initialization of storage
    const storageModule = await import('../lib/storage.js')
    
    // Reset storage instance to force re-initialization
    if (storageModule.closeStorage) {
      await storageModule.closeStorage()
    }
    
    const storage = storageModule.getStorage()

    const testEntry = {
      username: 'testuser-sqlite',
      class: 'editor',
      scope: 'openid profile email',
      groups: ['editor', 'users', 'special-chars'],
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
  })

  test('SQLite storage expiration cleanup', async () => {
    mockConfig.DATABASE_PATH = testDbPath
    
    const storageModule = await import('../lib/storage.js')
    const storage = storageModule.getStorage()

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
  })

  test('SQLite storage handles null/undefined values', async () => {
    mockConfig.DATABASE_PATH = testDbPath
    
    const storageModule = await import('../lib/storage.js')
    const storage = storageModule.getStorage()

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

  test('SQLite database file persistence', async () => {
    mockConfig.DATABASE_PATH = testDbPath
    
    const storageModule = await import('../lib/storage.js')
    let storage = storageModule.getStorage()

    const testEntry = {
      username: 'persistent-user',
      class: 'viewer',
      groups: ['viewers']
    }

    await storage.set('persistent-code', testEntry)
    
    // Close the database
    if (storage.close) {
      await storage.close()
    }
    
    // Force re-initialization by clearing module cache and reimporting
    await storageModule.closeStorage()
    
    const storageModule2 = await import('../lib/storage.js?' + Date.now())
    const storage2 = storageModule2.getStorage()

    // Data should persist across restarts
    const retrieved = await storage2.get('persistent-code')
    assert(retrieved !== undefined, 'Entry should persist across database restarts')
    assert(retrieved.username === 'persistent-user', 'Username should match after restart')
  })

  test('SQLite fallback to memory on database error', async () => {
    // Set an invalid database path
    mockConfig.DATABASE_PATH = '/invalid/path/that/does/not/exist.db'
    
    // This should fall back to memory storage
    const storageModule = await import('../lib/storage.js?' + Date.now())
    const storage = storageModule.getStorage()

    // Should still work with memory storage
    const testEntry = {
      username: 'fallback-user'
    }

    await storage.set('fallback-code', testEntry)
    const retrieved = await storage.get('fallback-code')
    
    assert(retrieved !== undefined, 'Entry should exist in fallback memory storage')
    assert(retrieved.username === 'fallback-user', 'Username should match in fallback storage')
  })

  await runTests()

  // Cleanup
  try {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath)
    }
    if (fs.existsSync(testDir)) {
      fs.rmdirSync(testDir)
    }
  } catch (e) {
    // Ignore cleanup errors
  }

  console.log(`\nStorage tests completed: ${passed} passed, ${failed} failed`)
  
  if (failed > 0) {
    process.exit(1)
  }
}

// Handle ES module compatibility
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createStorageTest().catch(console.error)
}

export { createStorageTest }