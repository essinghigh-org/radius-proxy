import { expect, test } from 'bun:test'
import { closeStorage, getStorage } from '../lib/storage'

test('a full refresh-token store revokes the oldest token and accepts new sessions', async () => {
  await closeStorage()
  const storage = getStorage()
  const entry = { username: 'alice', clientId: 'grafana', expiresAt: Date.now() + 60000 }
  for (let i = 0; i < 10001; i++) await storage.setRefreshToken(`token-${i}`, entry)
  expect(await storage.consumeRefreshToken('token-0')).toBeUndefined()
  expect((await storage.consumeRefreshToken('token-1'))?.username).toBe('alice')
  expect((await storage.consumeRefreshToken('token-10000'))?.username).toBe('alice')
})
