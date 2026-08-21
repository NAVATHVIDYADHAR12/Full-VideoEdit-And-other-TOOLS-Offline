/* account.js — the navigation menu, and the account screens.
 *
 * Injected rather than written into every page, so the menu cannot drift
 * between the landing page and the collection page.
 *
 * IMPORTANT, AND DELIBERATE: the sign-up and log-in forms are a design, not a
 * working account system. This site is static — there is no server, no database
 * and no session. Wiring these fields to browser storage would look like it
 * worked while protecting nothing, and would invite people to type a password
 * they use elsewhere. So the fields are inert and say so.
 *
 * TO MAKE ACCOUNTS REAL, replace the two functions marked BACKEND below with
 * calls to whichever provider you choose. Nothing else here needs to change.
 */
(function () {
'use strict';

const nav = document.getElementById('nav');
if (!nav) return;

const ACCOUNTS_LIVE = false;      // flip to true once a real backend is wired in

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
  '<div class="msep"></div>' +
  '<a class="mitem" href="pricing.html">' +
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M20.6 13.4 12 22l-9-9V3h10z"/><circle cx="7.5" cy="7.5" r="1.4"/></svg>' +
    '<span><b>Pricing</b><small>Plans and what they include</small></span></a>' +
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
let modal = null, titleEl = null, bodyEl = null, tabs = null;

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
  tabs = [...modal.querySelectorAll('.atab')];
  tabs.forEach(t => t.addEventListener('click', () => render(t.dataset.tab)));
  modal.querySelector('.authclose').addEventListener('click', closeAuth);
  modal.addEventListener('click', e => { if (e.target === modal) closeAuth(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.classList.contains('open')) closeAuth();
  });
}

function field(id, label, type, hint){
  return '<label class="afield"><span>' + label + '</span>' +
    '<input id="' + id + '" type="' + type + '" ' +
    (ACCOUNTS_LIVE ? '' : 'disabled ') +
    'autocomplete="off">' +
    (hint ? '<small>' + hint + '</small>' : '') + '</label>';
}

function render(which){
  build();
  tabs.forEach(t => t.classList.toggle('on', t.dataset.tab === which));

  const isSignup = which === 'signup';
  bodyEl.innerHTML =
    '<h3>' + (isSignup ? 'Create an account' : 'Welcome back') + '</h3>' +
    '<p class="asub">' + (isSignup
      ? 'One account for the plans and for whatever ships next.'
      : 'Sign in to manage your plan.') + '</p>' +

    /* Said plainly, at the top, before anyone types anything. */
    '<div class="anotice">' +
      '<b>Accounts are not live yet.</b> This is the design, not a working ' +
      'sign-in. The ten tools need no account and are free to use today — ' +
      'they run entirely on your machine.' +
    '</div>' +

    (isSignup ? field('acc-name', 'Name', 'text', '') : '') +
    field('acc-email', 'Email', 'email', '') +
    field('acc-pass', 'Password', 'password',
          isSignup ? 'At least 10 characters.' : '') +

    '<button type="button" class="asubmit" disabled>' +
      (isSignup ? 'Create account' : 'Log in') + '</button>' +

    '<p class="aswap">' + (isSignup
      ? 'Already have one? <a href="#" data-tab-to="login">Log in</a>'
      : 'No account yet? <a href="#" data-tab-to="signup">Sign up</a>') + '</p>';

  bodyEl.querySelectorAll('[data-tab-to]').forEach(a => {
    a.addEventListener('click', e => { e.preventDefault(); render(a.dataset.tabTo); });
  });

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeAuth(){
  if (!modal) return;
  modal.classList.remove('open');
  document.body.style.overflow = '';
}

menu.querySelectorAll('[data-account]').forEach(btn => {
  btn.addEventListener('click', () => {
    setMenu(false);
    render(btn.dataset.account);
  });
});

/* =============================================================================
 *  BACKEND — the only two places that need to change.
 *
 *  Both are unimplemented on purpose. A static site cannot hold a session or a
 *  password safely, and a fake one is worse than none: it looks trustworthy
 *  while protecting nothing.
 *
 *  When a provider is chosen, implement these two, set ACCOUNTS_LIVE to true at
 *  the top of this file, and the forms above become live as they are.
 * ========================================================================== */

async function signUp(/* name, email, password */){
  throw new Error('No authentication backend is configured.');
}

async function logIn(/* email, password */){
  throw new Error('No authentication backend is configured.');
}

window.Account = { signUp, logIn, open: render, close: closeAuth, live: ACCOUNTS_LIVE };

})();
