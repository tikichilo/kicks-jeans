const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');

function runNode(source, settings = {}) {
  const env = { ...process.env, NODE_ENV: 'test', ...settings };
  for (const key of ['PAYMENT_MODE', 'PAWAPAY_API_TOKEN', 'PAWAPAY_BASE_URL']) {
    if (!(key in settings)) delete env[key];
  }
  return spawnSync(process.execPath, ['-e', source], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8'
  });
}

test('payments stay disabled when credentials and mode are missing', () => {
  const result = runNode("process.stdout.write(require('./services/momo').MODE)");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'unconfigured');
});

test('mock payments require an explicit non-production setting', () => {
  const local = runNode("process.stdout.write(require('./services/momo').MODE)", {
    PAYMENT_MODE: 'mock'
  });
  assert.equal(local.status, 0, local.stderr);
  assert.equal(local.stdout, 'mock');

  const production = runNode("require('./services/momo')", {
    NODE_ENV: 'production',
    PAYMENT_MODE: 'mock'
  });
  assert.notEqual(production.status, 0);
  assert.match(production.stderr, /Mock payments are disabled in production/);
});

test('production requires live credentials and uses a non-sandbox URL', () => {
  const missingToken = runNode("require('./services/momo')", {
    NODE_ENV: 'production',
    PAWAPAY_BASE_URL: 'https://api.pawapay.io'
  });
  assert.notEqual(missingToken.status, 0);
  assert.match(missingToken.stderr, /PAWAPAY_API_TOKEN is required in production/);

  const defaultProductionUrl = runNode("process.stdout.write(require('./services/momo').MODE)", {
    NODE_ENV: 'production',
    PAWAPAY_API_TOKEN: 'test-token'
  });
  assert.equal(defaultProductionUrl.status, 0, defaultProductionUrl.stderr);
  assert.equal(defaultProductionUrl.stdout, 'live');

  const sandbox = runNode("require('./services/momo')", {
    NODE_ENV: 'production',
    PAWAPAY_API_TOKEN: 'test-token',
    PAWAPAY_BASE_URL: 'https://api.sandbox.pawapay.io'
  });
  assert.notEqual(sandbox.status, 0);
  assert.match(sandbox.stderr, /production URL/);
});

test('unconfigured payment attempts fail with a service-unavailable status', async () => {
  const result = runNode("require('./services/momo').initiatePayment({}).catch(error => { process.stdout.write(String(error.status)); })");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '503');
});