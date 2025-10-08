#!/usr/bin/env node

// Simple test for refresh token functionality using Node.js instead of Bun to avoid SQLite compatibility issues

const crypto = require('crypto')

console.log('Testing refresh token functionality (Node.js)...')

// Mock the config to force memory storage
const mockConfig = {
  OAUTH_CLIENT_ID: 'grafana',
  OAUTH_CLIENT_SECRET: 'secret',
  OAUTH_REFRESH_TOKEN_TTL: 2592000, // 30 days
  EMAIL_SUFFIX: 'example.com',
  ADMIN_CLASSES: ['admin_group'],
  PERMITTED_CLASSES: ['admin_group', 'editor_group']
}

// Mock the config module
const Module = require('module')
const originalRequire = Module.prototype.require
Module.prototype.require = function(id) {
  if (id.includes('config')) {
    return { config: mockConfig }
  }
  return originalRequire.apply(this, arguments)
}

// Force memory storage by unsetting DATABASE_PATH
delete process.env.DATABASE_PATH

async function testRefreshTokens() {
  try {
    // Import storage after mocking
    const { getStorage } = require('../lib/storage')
    const storage = getStorage()

    console.log('✓ Storage initialized')

    // Test storing and retrieving refresh token
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

    if (JSON.stringify(retrieved) === JSON.stringify(entry)) {
      console.log('✓ Store and retrieve refresh token')
    } else {
      throw new Error('Retrieved entry does not match stored entry')
    }

    // Test non-existent token
    const nonExistentToken = crypto.randomBytes(32).toString('base64url')
    const nonExistent = await storage.getRefreshToken(nonExistentToken)
    
    if (nonExistent === undefined) {
      console.log('✓ Non-existent token returns undefined')
    } else {
      throw new Error('Non-existent token should return undefined')
    }

    // Test deletion
    await storage.deleteRefreshToken(token)
    const deletedToken = await storage.getRefreshToken(token)
    
    if (deletedToken === undefined) {
      console.log('✓ Token deletion works')
    } else {
      throw new Error('Deleted token should return undefined')
    }

    // Test cleanup
    const expiredToken = crypto.randomBytes(32).toString('base64url')
    const validToken = crypto.randomBytes(32).toString('base64url')
    
    const expiredEntry = {
      username: 'expireduser',
      class: 'admin_group',
      scope: 'openid profile',
      groups: ['admin_group'],
      expiresAt: Date.now() - 1000, // Expired
      clientId: 'grafana'
    }
    
    const validEntry = {
      username: 'validuser',
      class: 'admin_group',
      scope: 'openid profile',
      groups: ['admin_group'],
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // Valid
      clientId: 'grafana'
    }

    await storage.setRefreshToken(expiredToken, expiredEntry)
    await storage.setRefreshToken(validToken, validEntry)
    
    await storage.cleanupRefreshTokens()
    
    const expiredResult = await storage.getRefreshToken(expiredToken)
    const validResult = await storage.getRefreshToken(validToken)
    
    if (expiredResult === undefined && JSON.stringify(validResult) === JSON.stringify(validEntry)) {
      console.log('✓ Cleanup removes expired tokens but keeps valid ones')
    } else {
      throw new Error('Cleanup did not work correctly')
    }

    console.log('\n✅ All refresh token tests passed!')
    return true
  } catch (err) {
    console.error(`\n❌ Test failed: ${err.message}`)
    return false
  }
}

testRefreshTokens()
  .then(success => {
    process.exit(success ? 0 : 1)
  })
  .catch(err => {
    console.error('Test runner error:', err)
    process.exit(1)
  })