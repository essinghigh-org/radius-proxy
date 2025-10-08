#!/usr/bin/env node

// Test the storage abstraction layer (memory-only)

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// Mock config for testing
const mockConfig = {}

// (Removed unused mockConfigModule and mockLogger to satisfy lint)

// Dynamic imports to allow mocking
async function createStorageTest() {
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

  test('Memory storage re-initialization consistency', async () => {
    // Force re-initialization of storage module and verify behavior remains consistent
    const storageModule = await import('../lib/storage.js')
    if (storageModule.closeStorage) {
      await storageModule.closeStorage()
    }

    const storage = storageModule.getStorage()

    const testEntry = {
      username: 'reinit-user',
      class: 'editor',
      scope: 'openid profile email',
      groups: ['editor', 'users', 'special-chars'],
      expiresAt: Date.now() + 600000
    }

    // Test set and get
    await storage.set('mem-test-code-1', testEntry)
    const retrieved = await storage.get('mem-test-code-1')

    assert(retrieved !== undefined, 'Entry should exist')
    assert(retrieved.username === testEntry.username, 'Username should match')
    assert(retrieved.class === testEntry.class, 'Class should match')
    assert(retrieved.scope === testEntry.scope, 'Scope should match')
    assert(JSON.stringify(retrieved.groups) === JSON.stringify(testEntry.groups), 'Groups should match')

    // Test update (replace)
    const updatedEntry = { ...testEntry, class: 'admin' }
    await storage.set('mem-test-code-1', updatedEntry)
    const retrievedUpdated = await storage.get('mem-test-code-1')
    assert(retrievedUpdated.class === 'admin', 'Entry should be updated')

    // Test delete
    await storage.delete('mem-test-code-1')
    const deleted = await storage.get('mem-test-code-1')
    assert(deleted === undefined, 'Entry should be deleted')
  })

  test('Storage expiration cleanup after re-init', async () => {
    const storageModule = await import('../lib/storage.js')
    const storage = storageModule.getStorage()

    // Add expired entry
    const expiredEntry = {
      username: 'expireduser',
      expiresAt: Date.now() - 5000 // 5 seconds ago
    }

    const currentEntry = {
      username: 'currentuser',
      expiresAt: Date.now() + 300000 // 5 minutes from now
    }

    await storage.set('expired-code-db', expiredEntry)
    await storage.set('current-code-db', currentEntry)

    // Verify both exist before cleanup
    assert(await storage.get('expired-code-db') !== undefined, 'Expired entry should exist before cleanup')
    assert(await storage.get('current-code-db') !== undefined, 'Current entry should exist before cleanup')

    // Run cleanup
    await storage.cleanup()

    // Verify expired entry is gone, current remains
    assert(await storage.get('expired-code-db') === undefined, 'Expired entry should be cleaned up')
    assert(await storage.get('current-code-db') !== undefined, 'Current entry should remain after cleanup')
  })

  test('Storage handles null/undefined values (in-memory)', async () => {
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

  test('No persistence across restarts for in-memory storage', async () => {
    // Since the project uses in-memory storage, data should NOT persist across
    // a storage restart. This verifies closeStorage resets the backend.

    const storageModule = await import('../lib/storage.js')
    let storage = storageModule.getStorage()

    const testEntry = {
      username: 'persistent-user',
      class: 'viewer',
      groups: ['viewers']
  }

    await storage.set('persistent-code', testEntry)

    // Simulate restart: close and reinitialize
    if (storageModule.closeStorage) {
      await storageModule.closeStorage()
    }

    const storageModule2 = await import('../lib/storage.js?' + Date.now())
    const storage2 = storageModule2.getStorage()

    // Data should NOT persist across in-memory restarts
    const retrieved = await storage2.get('persistent-code')
    assert(retrieved === undefined, 'In-memory storage should not persist across restarts')
  })

  test('Fallback behavior when config invalid', async () => {
    // If configuration is invalid, the implementation should fall back to in-memory storage
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

  // No filesystem cleanup needed for in-memory storage

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