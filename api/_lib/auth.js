/* auth.js — password storage, sessions, and the small helpers every endpoint
 * repeats.
 *
 * Everything here uses node:crypto and nothing else. scrypt is deliberately
 * slow and memory-hard, which is the property that matters: it makes a stolen
 * database expensive to attack rather than merely inconvenient.
 *
 * Sessions are a random identifier held in the store, not a self-contained
 * token. That costs one read per request and buys real logout -- a signed token
 * stays valid until it expires no matter how many times you sign out.
 */
'use strict';

const crypto = require('crypto');
const store  = require('./store');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_DAYS = 30;
const SESSION_TTL  = SESSION_DAYS * 24 * 60 * 60;
const COOKIE = 'atelier_session';

/* ================= passwords ================= */

function scrypt(password, salt){
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT.keylen,
      { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p },
      (err, key) => err ? reject(err) : resolve(key));
  });
}

async function hashPassword(password){
  const salt = crypto.randomBytes(16);
  const key  = await scrypt(password, salt);
  return 'scrypt$' + SCRYPT.N + '$' + SCRYPT.r + '$' + SCRYPT.p + '$' +
         salt.toString('base64') + '$' + key.toString('base64');
}

async function verifyPassword(password, stored){
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, N, r, p, saltB64, keyB64] = parts;
  const salt     = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(keyB64, 'base64');

  const actual = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, expected.length,
      { N: Number(N), r: Number(r), p: Number(p) },
      (err, key) => err ? reject(err) : resolve(key));
  });

  // constant time: a length check first, because timingSafeEqual throws on a
  // mismatch and that throw would itself be a signal
  return actual.length === expected.length &&
         crypto.timingSafeEqual(actual, expected);
}

/* ================= sessions ================= */

async function createSession(userId){
  const id = crypto.randomBytes(32).toString('base64url');
  await store.setJSON('sess:' + id, { userId, at: Date.now() }, SESSION_TTL);
  return id;
}

async function readSession(req){
  const id = parseCookies(req)[COOKIE];
  if (!id) return null;
  const sess = await store.getJSON('sess:' + id);
  if (!sess) return null;
  return { id, userId: sess.userId };
}

const destroySession = id => store.del('sess:' + id);

function parseCookies(req){
  const out = {};
  const header = req.headers && req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')){
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

/** Secure is set only off localhost: a Secure cookie is silently dropped over
 *  plain http, which makes local development look like a broken login. */
function sessionCookie(req, value, maxAge){
  const host  = String((req.headers && req.headers.host) || '');
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const bits = [
    COOKIE + '=' + (value || ''),
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=' + (maxAge === undefined ? SESSION_TTL : maxAge),
  ];
  if (!local) bits.push('Secure');
  return bits.join('; ');
}

/* ================= request plumbing ================= */

function readBody(req){
  // Vercel parses JSON bodies for us; the local dev server does not.
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise(resolve => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1e5) raw = raw.slice(0, 1e5);   // nothing here is large
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function send(res, status, payload, cookie){
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (cookie) res.setHeader('Set-Cookie', cookie);
  res.end(JSON.stringify(payload));
}

/** One place to answer "the site owner has not finished setting this up",
 *  so no endpoint reports it as a server error the visitor could act on. */
function requireStore(res){
  if (store.configured()) return true;
  send(res, 503, { error: 'Accounts are not configured on this deployment yet.',
                   code: 'NO_STORE' });
  return false;
}

const clientIp = req =>
  String((req.headers && req.headers['x-forwarded-for']) || '')
    .split(',')[0].trim() ||
  (req.socket && req.socket.remoteAddress) || 'unknown';

/* ================= validation ================= */

const normalizeEmail = e => String(e || '').trim().toLowerCase();

// Deliberately permissive. The only authority on whether an address works is
// the address itself; a clever pattern here only ever rejects real people.
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;

const MIN_PASSWORD = 10;

function passwordProblem(pw){
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD)
    return 'Password must be at least ' + MIN_PASSWORD + ' characters.';
  if (pw.length > 200) return 'That password is too long.';
  return null;
}

const publicUser = u => ({ id: u.id, name: u.name, email: u.email, createdAt: u.createdAt });

module.exports = {
  COOKIE, SESSION_TTL, MIN_PASSWORD,
  hashPassword, verifyPassword,
  createSession, readSession, destroySession, sessionCookie, parseCookies,
  readBody, send, requireStore, clientIp,
  normalizeEmail, validEmail, passwordProblem, publicUser,
};
