/* End-to-end drive of the auth endpoints against an in-memory Redis. */
'use strict';
process.env.KV_REST_API_URL = 'http://fake-kv.local';
process.env.KV_REST_API_TOKEN = 'test-token';

const { EventEmitter } = require('events');

/* ---- a small Redis that speaks the Upstash REST protocol ---- */
const DB = new Map();
global.fetch = async (url, opts) => {
  const [op, key, val, ...rest] = JSON.parse(opts.body);
  let result = null;
  switch (op){
    case 'GET':    result = DB.has(key) ? DB.get(key) : null; break;
    case 'SET':
      if (rest.includes('NX') || val === 'NX'){ }
      if (JSON.parse(opts.body).includes('NX')){
        if (DB.has(key)) { result = null; } else { DB.set(key, val); result = 'OK'; }
      } else { DB.set(key, val); result = 'OK'; }
      break;
    case 'DEL':    result = DB.delete(key) ? 1 : 0; break;
    case 'INCR':   result = (DB.set(key, String(Number(DB.get(key) || 0) + 1)), Number(DB.get(key))); break;
    case 'EXPIRE': result = 1; break;
    default: throw new Error('unhandled op ' + op);
  }
  return { ok: true, json: async () => ({ result }), text: async () => '' };
};

/* ---- fake req/res ---- */
function mkReq(method, body, cookie){
  const r = new EventEmitter();
  r.method = method; r.headers = { host: 'localhost:8123' };
  if (cookie) r.headers.cookie = cookie;
  r.socket = { remoteAddress: '1.2.3.4' };
  r.body = body;
  return r;
}
function mkRes(){
  const r = { headers: {}, statusCode: 200 };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.end = s => { r.raw = s; r.json = JSON.parse(s); };
  return r;
}
const cookieOf = res => {
  const sc = res.headers['set-cookie'];
  return sc ? sc.split(';')[0] : null;
};

const signup = require('../api/signup');
const login  = require('../api/login');
const me     = require('../api/me');
const logout = require('../api/logout');

const ok = (n, c) => console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + n);

async function call(fn, method, body, cookie){
  const res = mkRes();
  await fn(mkReq(method, body, cookie), res);
  return res;
}

(async () => {
console.log('\n=== signing up ===');
let r = await call(signup, 'POST', { name:'Vidyadhar', email:'  Vidyadhar@Example.COM ', password:'correct-horse-battery' });
ok('creates the account (201)', r.statusCode === 201);
ok('  returns the user', r.json.user && r.json.user.name === 'Vidyadhar');
ok('  email normalised to lowercase', r.json.user.email === 'vidyadhar@example.com');
ok('  never returns the password', !('password' in (r.json.user || {})));
ok('  sets an HttpOnly session cookie', /HttpOnly/.test(r.headers['set-cookie'] || ''));
ok('  no Secure flag on localhost', !/Secure/.test(r.headers['set-cookie'] || ''));
const session = cookieOf(r);

console.log('\n=== the password at rest ===');
const stored = JSON.parse(DB.get('user:vidyadhar@example.com'));
console.log('    ' + stored.password.slice(0, 62) + '...');
ok('stored as scrypt, not plaintext', stored.password.startsWith('scrypt$') &&
   !stored.password.includes('correct-horse-battery'));

console.log('\n=== duplicates and validation ===');
r = await call(signup, 'POST', { name:'Someone', email:'vidyadhar@example.com', password:'another-long-one' });
ok('rejects a taken email (409)', r.statusCode === 409);
r = await call(signup, 'POST', { name:'X', email:'x@y.co', password:'short' });
ok('rejects a short password (400)', r.statusCode === 400 && /10 characters/.test(r.json.error));
r = await call(signup, 'POST', { name:'X', email:'not-an-email', password:'long-enough-here' });
ok('rejects a bad address (400)', r.statusCode === 400);

console.log('\n=== session ===');
r = await call(me, 'GET', null, session);
ok('/api/me knows who it is', r.json.user && r.json.user.email === 'vidyadhar@example.com');
r = await call(me, 'GET', null, null);
ok('  and returns nobody without the cookie', r.json.user === null);
r = await call(me, 'GET', null, 'atelier_session=forged-value');
ok('  a forged cookie is not a session', r.json.user === null);

console.log('\n=== logging in ===');
r = await call(login, 'POST', { email:'VIDYADHAR@example.com', password:'correct-horse-battery' });
ok('accepts the right password (200)', r.statusCode === 200);
ok('  case-insensitive email', r.json.user && r.json.user.email === 'vidyadhar@example.com');
const session2 = cookieOf(r);
r = await call(login, 'POST', { email:'vidyadhar@example.com', password:'wrong-password-here' });
ok('refuses the wrong password (401)', r.statusCode === 401);
const msgWrong = r.json.error;
r = await call(login, 'POST', { email:'nobody@example.com', password:'wrong-password-here' });
ok('refuses an unknown account (401)', r.statusCode === 401);
ok('  same message either way (no account enumeration)', r.json.error === msgWrong);

console.log('\n=== logging out ===');
r = await call(logout, 'POST', null, session2);
ok('clears the cookie', /Max-Age=0/.test(r.headers['set-cookie'] || ''));
r = await call(me, 'GET', null, session2);
ok('  and the session is dead server-side', r.json.user === null);
r = await call(me, 'GET', null, session);
ok('  the other session still works (only one was ended)', r.json.user !== null);

console.log('\n=== rate limiting ===');
let blocked = 0;
for (let i = 0; i < 14; i++){
  const rr = await call(login, 'POST', { email:'target@example.com', password:'guess-guess-guess' });
  if (rr.statusCode === 429) blocked++;
}
ok('locks out after repeated failures (' + blocked + ' blocked)', blocked > 0);

console.log('\n=== no database configured ===');
delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;
r = await call(me, 'GET', null, null);
ok('/api/me stays calm (200, nobody)', r.statusCode === 200 && r.json.accounts === false);
r = await call(login, 'POST', { email:'a@b.co', password:'0123456789' });
ok('/api/login says so plainly (503)', r.statusCode === 503 && r.json.code === 'NO_STORE');
process.exit(0);
})();
