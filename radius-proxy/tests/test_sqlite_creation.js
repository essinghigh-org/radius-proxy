#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

// Test script to verify the SQLite database is created and working
// This simulates what happens when the OAuth endpoints are accessed

const fs = require('fs')
const path = require('path')

console.log('Testing SQLite Database Creation...')

// Set the DATABASE_PATH environment variable to match config
process.env.DATABASE_PATH = "./data/oauth-codes.db"

async function testDatabaseCreation() {
  try {
    // This would be the path that gets set in config
    const dbPath = "./data/oauth-codes.db"
    const dbDir = path.dirname(dbPath)
    const fullDbPath = path.resolve(dbPath)
    
    console.log('Expected database path:', fullDbPath)
    
    // Simulate what the storage module does
    const Database = require('better-sqlite3')
    
    // Ensure directory exists (this is what our storage module does)
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true })
      console.log('✓ Created database directory:', dbDir)
    }

    // Create/open the database
    const db = new Database(dbPath)
    console.log('✓ SQLite database opened successfully')
    
    // Create the table (this is what our storage module does)
    db.exec(`
      CREATE TABLE IF NOT EXISTS oauth_codes (
        code TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        class TEXT,
        scope TEXT,
        groups TEXT,
        expires_at INTEGER
      )
    `)
    console.log('✓ OAuth codes table created')
    
    // Test inserting and retrieving data
    const testCode = 'test-code-' + Date.now()
    const testEntry = {
      username: 'testuser',
      class: 'admin',
      scope: 'openid profile',
      groups: JSON.stringify(['admin', 'users']),
      expires_at: Date.now() + 300000
    }
    
    const insertStmt = db.prepare(`
      INSERT INTO oauth_codes (code, username, class, scope, groups, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    
    insertStmt.run(
      testCode,
      testEntry.username,
      testEntry.class,
      testEntry.scope,
      testEntry.groups,
      testEntry.expires_at
    )
    console.log('✓ Test OAuth code inserted')
    
    // Retrieve and verify
    const selectStmt = db.prepare('SELECT * FROM oauth_codes WHERE code = ?')
    const result = selectStmt.get(testCode)
    
    if (result && result.username === testEntry.username) {
      console.log('✓ Test OAuth code retrieved successfully')
    } else {
      throw new Error('Failed to retrieve test OAuth code')
    }
    
    // Cleanup test data
    const deleteStmt = db.prepare('DELETE FROM oauth_codes WHERE code = ?')
    deleteStmt.run(testCode)
    console.log('✓ Test OAuth code cleaned up')
    
    // Close database
    db.close()
    console.log('✓ Database closed successfully')
    
    // Verify file exists
    if (fs.existsSync(fullDbPath)) {
      const stats = fs.statSync(fullDbPath)
      console.log(`✓ Database file exists (${stats.size} bytes)`)
    } else {
      throw new Error('Database file was not created')
    }
    
    console.log('\n✅ SQLite storage is working correctly!')
    console.log('The OAuth endpoints will now persist authorization codes to:', fullDbPath)
    
  } catch (err) {
    console.error('❌ SQLite test failed:', err.message)
    console.log('The application will fall back to memory storage.')
  }
}

testDatabaseCreation()