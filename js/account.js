/* account.js — the navigation menu, and the account screens.
 *
 * Injected rather than written into every page, so the menu cannot drift
 * between the landing page and the collection page.
 *
 * The forms are real. They post to the serverless endpoints in /api, which hold
 * passwords as scrypt hashes and hand back an HttpOnly session cookie. Nothing
 * sensitive is kept in this file or in browser storage: the cookie is invisible
 * to script by design, so the only way to know who is signed in is to ask the
 * server, which is what refresh() does on load.
 *
 * The ten tools do not use any of this. They run offline and need no account;
 * an account exists only for plans and for whatever ships next.
 */
(function () {
'use strict';

const nav = document.getElementById('nav');
if (!nav) return;

/* ================= the button ================= */
const burger = document.createElement('button');
burger.className = 'navburger';
burger.id = 'navburger';
burger.type = 'button';
burger.setAttribute('aria-label', 'Menu');
burger.setAttribute('aria-expanded', 'false');
burger.innerHTML = '<span></span><span></span><span></span>';
nav.appendChild(burger);          // sits to the right of the call to action

/* ================= the dropdown ================= */
const menu = document.createElement('div');
menu.className = 'navmenu';
menu.id = 'navmenu';
menu.innerHTML =
  '<div class="mauth">' +
  '<button type="button" class="mitem" data-account="signup">' +
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>' +
      '<circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>' +
    '<span><b>Sign up</b><small>Create an account</small></span></button>' +
  '<button type="button" class="mitem" data-account="login">' +
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>' +
      '<path d="M10 17l5-5-5-5M15 12H3"/></svg>' +
    '<span><b>Log in</b><small>Return to your account</small></span></button>' +
  '</div>' +
  '<div class="msep"></div>' +
  '<a class="mitem" href="pricing.html">' +
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M20.6 13.4 12 22l-9-9V3h10z"/><circle cx="7.5" cy="7.5" r="1.4"/></svg>' +
    '<span><b>Pricing</b><small>Plans and what they include</small></span></a>' +
  '<a class="mitem" href="index.html#feedback">' +
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.9 9.9 0 0 1-2.8-.4L3 21l1.9-5.1A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/></svg>' +
    '<span><b>Feedback &amp; support</b><small>Rate it, or get help</small></span></a>' +
  '<a class="mitem" href="tools.html">' +
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>' +
      '<rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>' +
    '<span><b>All tools</b><small>The full collection</small></span></a>';
nav.appendChild(menu);

let open = false;
function setMenu(on){
  open = on;
  menu.classList.toggle('open', on);
  burger.classList.toggle('on', on);
  burger.setAttribute('aria-expanded', on ? 'true' : 'false');
}
burger.addEventListener('click', e => { e.stopPropagation(); setMenu(!open); });
document.addEventListener('click', e => {
  if (open && !menu.contains(e.target) && e.target !== burger) setMenu(false);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) setMenu(false); });

/* ================= account screens ================= */
const authArea = menu.querySelector('.mauth');
const signedOutHTML = authArea.innerHTML;

/* The cookie is HttpOnly, so this is the only copy of "who is signed in" the
   page has, and it is a cache of the server's answer rather than the truth. */
let state = { user: null, accounts: true };

function icon(d){
  return '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + '</svg>';
}

function paintMenu(){
  if (!state.user){ authArea.innerHTML = signedOutHTML; bindAccountButtons(); return; }

  const initial = (state.user.name || state.user.email || '?').trim().charAt(0).toUpperCase();
  authArea.innerHTML =
    '<div class="mwho">' +
      '<span class="mavatar" aria-hidden="true">' + initial + '</span>' +
      '<span><b>' + esc(state.user.name) + '</b>' +
      '<small>' + esc(state.user.email) + '</small></span>' +
    '</div>' +
    '<button type="button" class="mitem" data-logout>' +
      icon('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>' +
           '<path d="M16 17l5-5-5-5M21 12H9"/>') +
      '<span><b>Log out</b><small>End this session</small></span></button>';

  authArea.querySelector('[data-logout]').addEventListener('click', async () => {
    setMenu(false);
    try { await fetch('/api/logout', { method:'POST', credentials:'same-origin' }); }
    catch (err) { /* the cookie is cleared server-side or not at all; either way, re-ask */ }
    await refresh();
  });
}

function bindAccountButtons(){
  authArea.querySelectorAll('[data-account]').forEach(btn => {
    btn.addEventListener('click', () => { setMenu(false); render(btn.dataset.account); });
  });
}

/** Ask the server who this is. Runs on load, and after every change. */
async function refresh(){
  try {
    const res  = await fetch('/api/me', { credentials:'same-origin' });
    const data = await res.json();
    state.user     = data.user || null;
    state.accounts = data.accounts !== false;
  } catch (err) {
    // Offline is the normal case for this app, and it is not a failure: the
    // tools all work without the network. Present it as simply signed out.
    state.user = null;
  }
  paintMenu();
  return state.user;
}

const esc = str => String(str == null ? '' : str)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ================= the dialog ================= */
let modal = null, bodyEl = null, tabs = null;

function build(){
  if (modal) return;
  modal = document.createElement('div');
  modal.className = 'authwrap';
  modal.innerHTML =
    '<div class="authcard" role="dialog" aria-modal="true" aria-label="Account">' +
      '<button type="button" class="authclose" aria-label="Close">&times;</button>' +
      '<div class="authtabs">' +
        '<button type="button" class="atab" data-tab="signup">Sign up</button>' +
        '<button type="button" class="atab" data-tab="login">Log in</button>' +
      '</div>' +
      '<div class="authbody"></div>' +
    '</div>';
  document.body.appendChild(modal);

  bodyEl = modal.querySelector('.authbody');
  tabs = [].slice.call(modal.querySelectorAll('.atab'));
  tabs.forEach(t => t.addEventListener('click', () => render(t.dataset.tab)));
  modal.querySelector('.authclose').addEventListener('click', closeAuth);
  modal.addEventListener('click', e => { if (e.target === modal) closeAuth(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.classList.contains('open')) closeAuth();
  });
}

/* autocomplete is switched on deliberately. The old form said "off", which
   stops a password manager offering a strong password and pushes people
   towards one they can retype -- the opposite of what it looks like. */
function field(id, label, type, complete, hint){
  return '<label class="afield" for="' + id + '"><span>' + label + '</span>' +
    '<input id="' + id + '" name="' + id + '" type="' + type + '" ' +
    'autocomplete="' + complete + '" required>' +
    (hint ? '<small>' + hint + '</small>' : '') + '</label>';
}

function render(which){
  build();
  const isSignup = which !== 'login';
  tabs.forEach(t => t.classList.toggle('on', (t.dataset.tab === 'signup') === isSignup));

  bodyEl.innerHTML =
    '<h3>' + (isSignup ? 'Create an account' : 'Welcome back') + '</h3>' +
    '<p class="asub">' + (isSignup
      ? 'For plans and for whatever ships next. The ten tools stay free and need no account.'
      : 'Sign in to manage your plan.') + '</p>' +

    (state.accounts ? '' :
      '<div class="anotice">Accounts are not configured on this deployment yet.</div>') +

    '<form class="aform" novalidate>' +
      (isSignup ? field('acc-name', 'Name', 'text', 'name', '') : '') +
      field('acc-email', 'Email', 'email', 'email', '') +
      field('acc-pass', 'Password', 'password',
            isSignup ? 'new-password' : 'current-password',
            isSignup ? 'At least 10 characters.' : '') +
      '<p class="aerr" role="alert" hidden></p>' +
      '<button type="submit" class="asubmit">' +
        (isSignup ? 'Create account' : 'Log in') + '</button>' +
    '</form>' +

    '<p class="aswap">' + (isSignup
      ? 'Already have one? <a href="#" data-tab-to="login">Log in</a>'
      : 'No account yet? <a href="#" data-tab-to="signup">Sign up</a>') + '</p>';

  bodyEl.querySelectorAll('[data-tab-to]').forEach(a => {
    a.addEventListener('click', e => { e.preventDefault(); render(a.dataset.tabTo); });
  });
  bodyEl.querySelector('.aform').addEventListener('submit', e => {
    e.preventDefault();
    submit(isSignup);
  });

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  // focus the first empty field, so the keyboard lands where typing starts
  const first = bodyEl.querySelector('input');
  if (first) setTimeout(() => first.focus(), 60);
}

async function submit(isSignup){
  const form   = bodyEl.querySelector('.aform');
  const button = form.querySelector('.asubmit');
  const errEl  = form.querySelector('.aerr');
  const value  = id => { const el = bodyEl.querySelector('#' + id); return el ? el.value : ''; };

  const payload = isSignup
    ? { name: value('acc-name'), email: value('acc-email'), password: value('acc-pass') }
    : { email: value('acc-email'), password: value('acc-pass') };

  errEl.hidden = true;
  button.disabled = true;
  const label = button.textContent;
  button.textContent = isSignup ? 'Creating\u2026' : 'Signing in\u2026';

  try {
    const res = await fetch(isSignup ? '/api/signup' : '/api/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok){
      errEl.textContent = data.error || 'Something went wrong. Please try again.';
      errEl.hidden = false;
      return;
    }
    state.user = data.user;
    paintMenu();
    closeAuth();

  } catch (err) {
    errEl.textContent = 'Could not reach the server. Check your connection and try again.';
    errEl.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

function closeAuth(){
  if (!modal) return;
  modal.classList.remove('open');
  document.body.style.overflow = '';
}

bindAccountButtons();
refresh();

window.Account = {
  open: render,
  close: closeAuth,
  refresh,
  get user(){ return state.user; },
};

})();
