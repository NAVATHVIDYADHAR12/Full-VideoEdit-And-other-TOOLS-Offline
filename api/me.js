/* GET /api/me -> { user } or { user:null }. Restores the session on page load. */
'use strict';

const store = require('./_lib/store');
const a     = require('./_lib/auth');

module.exports = async function handler(req, res){
  /* Not an error when unconfigured: the page asks this on every load, and a
     site with no database simply has nobody signed in. */
  if (!store.configured()) return a.send(res, 200, { user: null, accounts: false });

  try {
    const sess = await a.readSession(req);
    if (!sess) return a.send(res, 200, { user: null, accounts: true });

    const email = await store.getJSON('uid:' + sess.userId);
    const user  = email ? await store.getJSON('user:' + email) : null;

    /* The session outlived the account it belonged to. Clear the cookie rather
       than leaving the browser to present it forever. */
    if (!user){
      await a.destroySession(sess.id);
      return a.send(res, 200, { user: null, accounts: true }, a.sessionCookie(req, '', 0));
    }
    return a.send(res, 200, { user: a.publicUser(user), accounts: true });

  } catch (err) {
    console.error('session lookup failed:', err);
    return a.send(res, 200, { user: null, accounts: true });
  }
};
