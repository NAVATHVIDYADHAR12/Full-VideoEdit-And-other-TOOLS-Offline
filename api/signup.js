/* POST /api/signup  { name, email, password } -> { user }, sets the session. */
'use strict';

const crypto = require('crypto');
const store  = require('./_lib/store');
const a      = require('./_lib/auth');

module.exports = async function handler(req, res){
  if (req.method !== 'POST') return a.send(res, 405, { error: 'Method not allowed.' });
  if (!a.requireStore(res)) return;

  try {
    const body     = await a.readBody(req);
    const name     = String(body.name || '').trim().slice(0, 80);
    const email    = a.normalizeEmail(body.email);
    const password = body.password;

    if (!name)                return a.send(res, 400, { error: 'Please enter your name.' });
    if (!a.validEmail(email)) return a.send(res, 400, { error: 'That email address does not look right.' });

    const pwProblem = a.passwordProblem(password);
    if (pwProblem)            return a.send(res, 400, { error: pwProblem });

    /* Slow down anyone enumerating the user table by signing up repeatedly. */
    const tries = await store.bump('rl:signup:' + a.clientIp(req), 3600);
    if (tries > 20) return a.send(res, 429, { error: 'Too many attempts. Try again in an hour.' });

    const user = {
      id: crypto.randomUUID(),
      name,
      email,
      password: await a.hashPassword(password),
      createdAt: new Date().toISOString(),
    };

    /* One atomic write decides it. Checking for the address and then writing
       would let two simultaneous sign-ups both believe they were first. */
    const claimed = await store.setIfAbsent('user:' + email, user);
    if (!claimed) return a.send(res, 409, { error: 'That email already has an account. Log in instead.' });

    const sid = await a.createSession(user.id);
    await store.setJSON('uid:' + user.id, email);

    return a.send(res, 201, { user: a.publicUser(user) }, a.sessionCookie(req, sid));

  } catch (err) {
    console.error('signup failed:', err);
    return a.send(res, 500, { error: 'Could not create the account. Please try again.' });
  }
};
