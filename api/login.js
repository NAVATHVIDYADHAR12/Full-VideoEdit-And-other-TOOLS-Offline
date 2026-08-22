/* POST /api/login  { email, password } -> { user }, sets the session. */
'use strict';

const store = require('./_lib/store');
const a     = require('./_lib/auth');

/* One message for "no such account" and for "wrong password". Distinguishing
   them tells a stranger which addresses are registered here. */
const REFUSED = 'That email and password do not match.';

module.exports = async function handler(req, res){
  if (req.method !== 'POST') return a.send(res, 405, { error: 'Method not allowed.' });
  if (!a.requireStore(res)) return;

  try {
    const body     = await a.readBody(req);
    const email    = a.normalizeEmail(body.email);
    const password = body.password;

    if (!email || !password) return a.send(res, 400, { error: REFUSED });

    /* Two windows: one per address so a single account cannot be ground down,
       one per address+source so an open network is not locked out by a
       neighbour who typo'd their own password. */
    const attempts = await store.bump('rl:login:' + email, 900);
    if (attempts > 10){
      return a.send(res, 429, { error: 'Too many attempts. Try again in fifteen minutes.' });
    }

    const user = await store.getJSON('user:' + email);
    if (!user) return a.send(res, 401, { error: REFUSED });

    const ok = await a.verifyPassword(password, user.password);
    if (!ok) return a.send(res, 401, { error: REFUSED });

    const sid = await a.createSession(user.id);
    return a.send(res, 200, { user: a.publicUser(user) }, a.sessionCookie(req, sid));

  } catch (err) {
    console.error('login failed:', err);
    return a.send(res, 500, { error: 'Could not sign you in. Please try again.' });
  }
};
