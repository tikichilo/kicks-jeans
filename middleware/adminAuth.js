const crypto = require('crypto');
const Admin = require('../models/Admin');

const COOKIE_NAME = 'kj_admin_session';
const SESSION_SECONDS = 8 * 60 * 60;

function sessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

function sessionSignature(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function getSessionToken(req) {
  const prefix = `${COOKIE_NAME}=`;
  const entry = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(prefix));
  if (!entry) return null;
  try {
    return decodeURIComponent(entry.slice(prefix.length));
  } catch {
    return null;
  }
}

function readSession(req) {
  const secret = sessionSecret();
  const token = getSessionToken(req);
  if (!secret || !token) return null;

  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  const expected = Buffer.from(sessionSignature(payload, secret));
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!session.id || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

function setAdminSession(res, admin) {
  const secret = sessionSecret();
  const payload = Buffer.from(JSON.stringify({
    id: String(admin._id),
    expiresAt: Date.now() + SESSION_SECONDS * 1000
  })).toString('base64url');
  const token = `${payload}.${sessionSignature(payload, secret)}`;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secure}`);
}

function clearAdminSession(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${secure}`);
}

async function requireAdmin(req, res, next) {
  if (!sessionSecret()) return res.status(503).json({ error: 'Admin sessions are not configured' });
  const session = readSession(req);
  if (!session) return res.status(401).json({ error: 'Admin sign-in required' });

  try {
    const admin = await Admin.findById(session.id).select('_id name email');
    if (!admin) return res.status(401).json({ error: 'Admin sign-in required' });
    req.admin = admin;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Could not verify admin session' });
  }
}

module.exports = { COOKIE_NAME, SESSION_SECONDS, clearAdminSession, requireAdmin, sessionSecret, setAdminSession };