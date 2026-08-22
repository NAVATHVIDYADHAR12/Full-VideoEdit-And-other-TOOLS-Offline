/* store.js — the database, over HTTP.
 *
 * Deliberately dependency-free. Vercel installs nothing for this project
 * (`installCommand: null`), and a serverless function that needs a native
 * Postgres driver would change that for the whole repo. Upstash Redis and
 * Vercel KV both speak the same plain REST protocol, so `fetch` is the entire
 * client: send a command as a JSON array, read `result` back.
 *
 * Set either pair of environment variables and this file finds them:
 *   KV_REST_API_URL      + KV_REST_API_TOKEN         (Vercel KV / Marketplace)
 *   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN  (Upstash direct)
 */
'use strict';

function config(){
  const url   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

/** True when a database is actually reachable, so the API can say so plainly
 *  instead of failing with a stack trace the visitor cannot act on. */
function configured(){ return config() !== null; }

async function cmd(...args){
  const cfg = config();
  if (!cfg) throw new Error('NO_STORE');

  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + cfg.token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args.map(String)),
  });

  if (!res.ok){
    const detail = await res.text().catch(() => '');
    throw new Error('STORE_HTTP_' + res.status + (detail ? ': ' + detail.slice(0, 200) : ''));
  }
  const body = await res.json();
  if (body && body.error) throw new Error('STORE: ' + body.error);
  return body ? body.result : null;
}

/* ---- the handful of operations this app needs ---- */

async function getJSON(key){
  const raw = await cmd('GET', key);
  if (raw === null || raw === undefined) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { return null; }
}

async function setJSON(key, value, ttlSeconds){
  const raw = JSON.stringify(value);
  return ttlSeconds ? cmd('SET', key, raw, 'EX', ttlSeconds) : cmd('SET', key, raw);
}

/** Create only if absent. This is what makes "is the email taken" a single
 *  atomic step rather than a check followed by a write that can interleave. */
async function setIfAbsent(key, value){
  const ok = await cmd('SET', key, JSON.stringify(value), 'NX');
  return ok !== null;
}

const del = key => cmd('DEL', key);

/** Fixed-window counter, used to slow down password guessing. */
async function bump(key, ttlSeconds){
  const n = await cmd('INCR', key);
  if (n === 1) await cmd('EXPIRE', key, ttlSeconds);
  return n;
}

module.exports = { configured, cmd, getJSON, setJSON, setIfAbsent, del, bump };
