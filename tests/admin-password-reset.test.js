const express = require('express');
const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Admin = require('../models/Admin');

process.env.GMAIL_USER = 'mail-test@example.com';
process.env.GMAIL_PASS = 'test-app-password';

const mailerPath = require.resolve('../services/adminPasswordResetEmail');
require.cache[mailerPath] = {
  id: mailerPath,
  filename: mailerPath,
  loaded: true,
  exports: { sendPasswordResetEmail: async details => { sentEmails.push(details); } }
};
const sentEmails = [];
const adminRoutes = require('../routes/admin');

let resetTokenHash;
let resetExpiresAt;
let usedTokenHash;
let storedPasswordHash;

const admin = {
  _id: 'admin-id',
  email: 'owner@example.com',
  name: 'Store Owner',
  passwordResetTokenHash: null,
  passwordResetExpiresAt: null,
  async save() {
    resetTokenHash = this.passwordResetTokenHash;
    resetExpiresAt = this.passwordResetExpiresAt;
  }
};

Admin.findOne = async ({ email }) => email === admin.email ? admin : null;
Admin.updateOne = async () => ({ modifiedCount: 1 });
Admin.findOneAndUpdate = async (filter, update) => {
  if (usedTokenHash || filter.passwordResetTokenHash !== resetTokenHash ||
    resetExpiresAt <= filter.passwordResetExpiresAt.$gt) return null;
  usedTokenHash = filter.passwordResetTokenHash;
  storedPasswordHash = update.$set.passwordHash;
  return admin;
};

const app = express();
app.use(express.json());
app.use('/api/admin', adminRoutes);
const server = app.listen(0);
const endpoint = `http://127.0.0.1:${server.address().port}/api/admin`;

after(() => new Promise(resolve => server.close(resolve)));

async function post(path, body, ip) {
  return fetch(`${endpoint}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': ip
    },
    body: JSON.stringify(body)
  });
}

test('password reset emails a generic one-time link and consumes it once', async () => {
  const unknown = await post('/forgot-password', { email: 'missing@example.com' }, '192.0.2.11');
  const unknownBody = await unknown.json();
  assert.equal(unknown.status, 202);
  assert.match(unknownBody.message, /If an admin account exists/);
  assert.equal(sentEmails.length, 0);

  const requested = await post('/forgot-password', { email: 'OWNER@example.com' }, '192.0.2.12');
  const requestedBody = await requested.json();
  assert.equal(requested.status, 202);
  assert.deepEqual(requestedBody, unknownBody);
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, admin.email);
  assert.match(sentEmails[0].token, /^[a-f0-9]{64}$/);
  assert.equal(
    resetTokenHash,
    crypto.createHash('sha256').update(sentEmails[0].token).digest('hex')
  );
  assert.ok(resetExpiresAt > new Date());

  const reset = await post('/reset-password', {
    token: sentEmails[0].token,
    password: 'a-long-new-password'
  }, '192.0.2.13');
  assert.equal(reset.status, 200);
  assert.match(storedPasswordHash, /^scrypt\$/);
  assert.equal(usedTokenHash, resetTokenHash);

  const reused = await post('/reset-password', {
    token: sentEmails[0].token,
    password: 'another-long-password'
  }, '192.0.2.14');
  assert.equal(reused.status, 400);
});
