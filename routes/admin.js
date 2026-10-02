const express = require('express');
const crypto = require('crypto');
const { promisify } = require('util');
const Admin = require('../models/Admin');
const Order = require('../models/Order');
const { sendPasswordResetEmail } = require('../services/adminPasswordResetEmail');
const { clearAdminSession, requireAdmin, sessionSecret, setAdminSession } = require('../middleware/adminAuth');

const router = express.Router();
const scrypt = promisify(crypto.scrypt);
const authAttempts = new Map();
const AUTH_ATTEMPT_LIMIT = 10;
const AUTH_ATTEMPT_WINDOW = 15 * 60 * 1000;
const DUMMY_PASSWORD_SALT = 'admin-login-timing-salt';

function limitAuthAttempts(req, res, next) {
  const key = `${req.path}:${req.ip}`;
  const now = Date.now();
  const current = authAttempts.get(key);
  if (current && now - current.startedAt < AUTH_ATTEMPT_WINDOW && current.count >= AUTH_ATTEMPT_LIMIT) {
    res.set('Retry-After', String(Math.ceil((AUTH_ATTEMPT_WINDOW - (now - current.startedAt)) / 1000)));
    return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  }
  if (!current || now - current.startedAt >= AUTH_ATTEMPT_WINDOW) {
    authAttempts.set(key, { startedAt: now, count: 1 });
  } else {
    current.count++;
  }
  if (authAttempts.size > 5000) {
    for (const [attemptKey, attempt] of authAttempts) {
      if (now - attempt.startedAt >= AUTH_ATTEMPT_WINDOW) authAttempts.delete(attemptKey);
    }
    if (authAttempts.size > 5000) authAttempts.delete(authAttempts.keys().next().value);
  }
  next();
}

function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function publicAdmin(admin) {
  return { name: admin.name, email: admin.email };
}

function authConfigurationReady() {
  return Boolean(sessionSecret() && process.env.ADMIN_INVITE_CODE);
}

router.post('/signup', limitAuthAttempts, async (req, res) => {
  if (!authConfigurationReady()) {
    return res.status(503).json({ error: 'Admin sign-up is not configured. Set ADMIN_INVITE_CODE and a 32-character ADMIN_SESSION_SECRET.' });
  }

  const { name, email, password, inviteCode } = req.body;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80 ||
    typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
    typeof password !== 'string' || password.length < 12 || password.length > 200) {
    return res.status(400).json({ error: 'Enter a name, valid email, and password of at least 12 characters.' });
  }
  if (!safeEqual(inviteCode, process.env.ADMIN_INVITE_CODE)) {
    return res.status(403).json({ error: 'That invite code is not valid.' });
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();
    if (await Admin.exists({ email: normalizedEmail })) {
      return res.status(409).json({ error: 'An admin account already exists for that email.' });
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = (await scrypt(password, salt, 64)).toString('hex');
    const admin = await Admin.create({ name: name.trim(), email: normalizedEmail, passwordHash: `scrypt$${salt}$${passwordHash}` });
    authAttempts.delete(`${req.path}:${req.ip}`);
    setAdminSession(res, admin);
    res.status(201).json({ admin: publicAdmin(admin) });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'An admin account already exists for that email.' });
    res.status(500).json({ error: 'Could not create admin account.' });
  }
});

router.post('/login', limitAuthAttempts, async (req, res) => {
  if (!sessionSecret()) return res.status(503).json({ error: 'Admin sessions are not configured.' });
  const { email, password } = req.body;
  if (typeof email !== 'string' || typeof password !== 'string' || password.length > 200) {
    return res.status(400).json({ error: 'Enter your email and password.' });
  }

  try {
    const admin = await Admin.findOne({ email: email.trim().toLowerCase() });
    if (!admin) {
      await scrypt(password, DUMMY_PASSWORD_SALT, 64);
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }
    const [, salt, storedHash] = admin.passwordHash.split('$');
    const candidateHash = await scrypt(password, salt, 64);
    const expectedHash = Buffer.from(storedHash, 'hex');
    if (candidateHash.length !== expectedHash.length || !crypto.timingSafeEqual(candidateHash, expectedHash)) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }
    authAttempts.delete(`${req.path}:${req.ip}`);
    setAdminSession(res, admin);
    res.json({ admin: publicAdmin(admin) });
  } catch {
    res.status(500).json({ error: 'Could not sign in.' });
  }
});

router.post('/forgot-password', limitAuthAttempts, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const genericResponse = {
    message: 'If an admin account exists for that email, password reset instructions will be sent.'
  };
  const { email } = req.body;
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 254) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }

  try {
    const admin = await Admin.findOne({ email: email.trim().toLowerCase() });
    if (!admin) return res.status(202).json(genericResponse);

    const token = crypto.randomBytes(32).toString('hex');
    admin.passwordResetTokenHash = crypto.createHash('sha256').update(token).digest('hex');
    admin.passwordResetExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await admin.save();

    try {
      await sendPasswordResetEmail({ to: admin.email, name: admin.name, token });
    } catch (err) {
      await Admin.updateOne({ _id: admin._id }, {
        $unset: { passwordResetTokenHash: 1, passwordResetExpiresAt: 1 }
      });
      console.error('Could not send admin password reset email:', err.message);
    }
    return res.status(202).json(genericResponse);
  } catch (err) {
    console.error('Could not process admin password reset request:', err.message);
    return res.status(500).json({ error: 'Could not process the reset request. Please try again.' });
  }
});

router.post('/reset-password', limitAuthAttempts, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { token, password } = req.body;
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token) ||
    typeof password !== 'string' || password.length < 12 || password.length > 200) {
    return res.status(400).json({ error: 'Use a valid reset link and a password between 12 and 200 characters.' });
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = (await scrypt(password, salt, 64)).toString('hex');
    const admin = await Admin.findOneAndUpdate({
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: { $gt: new Date() }
    }, {
      $set: { passwordHash: `scrypt$${salt}$${passwordHash}` },
      $unset: { passwordResetTokenHash: 1, passwordResetExpiresAt: 1 }
    }, { new: true });

    if (!admin) return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });
    clearAdminSession(res);
    res.json({ message: 'Password updated. Sign in with your new password.' });
  } catch (err) {
    console.error('Could not reset admin password:', err.message);
    res.status(500).json({ error: 'Could not reset the password. Please try again.' });
  }
});

router.post('/logout', (req, res) => {
  clearAdminSession(res);
  res.status(204).end();
});

router.get('/me', requireAdmin, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ admin: publicAdmin(req.admin) });
});

router.get('/orders', requireAdmin, async (req, res) => {
  try {
    const orders = await Order.find()
      .sort({ createdAt: -1 })
      .limit(100)
      .select('orderCode items subtotal deliveryFee total customer payment.status status statusHistory shipment createdAt updatedAt')
      .lean();
    res.set('Cache-Control', 'no-store');
    res.json(orders);
  } catch {
    res.status(500).json({ error: 'Could not load orders.' });
  }
});

module.exports = router;