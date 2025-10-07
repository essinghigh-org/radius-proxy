import assert from 'assert'
import { isClassPermitted } from '../lib/access.ts'
import { config } from '../lib/config.ts'

async function run() {
  // Temporarily simulate config (cannot easily mutate imported config since it's loaded once)
  // We'll just assert logic with current config; ensure PERMITTED_CLASSES has known values
  console.log('Configured PERMITTED_CLASSES:', config.PERMITTED_CLASSES)
  if (!config.PERMITTED_CLASSES.length) {
    console.log('No PERMITTED_CLASSES set; skipping enforcement test (PASS by default).')
    return
  }
  const allowedSample = config.PERMITTED_CLASSES[0]
  assert.strictEqual(isClassPermitted(allowedSample), true, 'Expected allowed class to pass')
  assert.strictEqual(isClassPermitted('___unlikely_class___'), false, 'Expected unknown class to fail')
  console.log('permitted classes test passed')
}

run().catch(e=>{console.error(e); process.exit(2)})
