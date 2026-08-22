/* POST /api/logout -> {}, drops the session on the server and in the browser. */
'use strict';

const a = require('./_lib/auth');

module.exports = async function handler(req, res){
  if (req.method !== 'POST') return a.send(res, 405, { error: 'Method not allowed.' });

  try {
    const sess = await a.readSession(req);
    // Deleting the stored record is what makes this a real logout: the cookie
    // alone is only a request, and a copy of it would still work.
    if (sess) await a.destroySession(sess.id);
  } catch (err) {
    console.error('logout cleanup failed:', err);
  }
  // The cookie goes either way; a failure here must not strand someone signed in.
  return a.send(res, 200, { ok: true }, a.sessionCookie(req, '', 0));
};
