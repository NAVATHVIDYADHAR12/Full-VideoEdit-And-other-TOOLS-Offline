/* landing.js — floating navigation, the scroll-scrubbed hero, the treadmill
 * band, and the staged reveal transitions.
 *
 * The hero frames are real output from this app's own frame extractor, so the
 * page demonstrates the product simply by existing.
 */
(function () {
'use strict';

const FRAME_COUNT = 80;
const framePath = i => 'assets/hero/f' + String(i).padStart(3, '0') + '.jpg';

const nav      = document.getElementById('nav');
const navLinks = document.getElementById('navlinks');
const navToggle= document.getElementById('navtoggle');
const hero     = document.getElementById('hero');
const canvas   = document.getElementById('heroframes');
const counter  = document.getElementById('framecount');
const heroInner= document.getElementById('heroinner');
const toTop    = document.getElementById('totop');

/* ================= navigation behaviour =================
 * Two states worth separating: "has the page moved at all", which turns the bar
 * into a solid object, and "which way are you going", which hides or shows it.
 */
let lastY = window.scrollY;
let navSolid = false, navHidden = false, topShown = false, overTop = false;

function setSolid(on){
  if (on === navSolid) return;
  navSolid = on;
  nav.classList.toggle('stuck', on);
}
function setHidden(on){
  if (on === navHidden) return;
  navHidden = on;
  nav.classList.toggle('hidden', on);
}
function setTop(on){
  if (on === topShown || !toTop) return;
  topShown = on;
  toTop.classList.toggle('show', on);
}

function onDirection(){
  const y = Math.max(0, window.scrollY);
  setSolid(y > 24);

  // near the top nothing is hidden and nothing is offered
  if (y < 140){
    lastY = y;
    setHidden(false);
    if (!overTop) setTop(false);
    return;
  }
  const dy = y - lastY;
  if (Math.abs(dy) < 6) return;      // ignore the jitter of a trackpad settling
  lastY = y;

  const goingDown = dy > 0;
  setHidden(goingDown);              // nav steps aside on the way down
  if (!overTop) setTop(goingDown);   // and the return button takes its place
}

if (toTop){
  // do not let it vanish out from under the cursor mid-click
  toTop.addEventListener('pointerenter', () => { overTop = true; });
  toTop.addEventListener('pointerleave', () => { overTop = false; });
  toTop.addEventListener('click', () => {
    window.scrollTo({ top:0, behavior:'smooth' });
    setTop(false);
  });
}

if (navToggle){
  navToggle.onclick = () => navLinks.classList.toggle('open');
  navLinks.addEventListener('click', e => {
    if (e.target.tagName === 'A') navLinks.classList.remove('open');
  });
}

document.querySelectorAll('a[data-scroll]').forEach(a => {
  a.addEventListener('click', e => {
    const target = document.querySelector(a.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior:'smooth', block:'start' });
  });
});

/* ================= scroll-scrubbed frames ================= */
const images = new Array(FRAME_COUNT).fill(null);
let ctx = null, lastDrawn = -1, ticking = false;

function load(i){
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => { images[i] = img; resolve(img); };
    img.onerror = () => resolve(null);
    img.src = framePath(i + 1);
  });
}

/** Nearest already-loaded frame, so scrubbing never shows a blank canvas. */
function nearestLoaded(i){
  if (images[i]) return images[i];
  for (let d = 1; d < FRAME_COUNT; d++){
    if (images[i-d]) return images[i-d];
    if (images[i+d]) return images[i+d];
  }
  return null;
}

function draw(i){
  if (!ctx) return;
  const img = nearestLoaded(i);
  if (!img) return;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  if (counter) counter.textContent = String(i + 1).padStart(3, '0');
}

function update(){
  ticking = false;
  if (!hero) return;
  const rect = hero.getBoundingClientRect();
  const total = rect.height - window.innerHeight;
  const progress = total <= 0 ? 0 : Math.min(1, Math.max(0, -rect.top / total));

  const i = Math.min(FRAME_COUNT - 1, Math.round(progress * (FRAME_COUNT - 1)));
  if (i !== lastDrawn){ lastDrawn = i; draw(i); }

  hero.classList.toggle('scrolled', progress > 0.02);
  // the words step aside for the footage as the sequence plays out
  if (heroInner){
    const fade = progress < 0.6 ? 1 : Math.max(0, 1 - (progress - 0.6) / 0.28);
    heroInner.style.opacity = fade.toFixed(3);
    heroInner.style.transform = 'translateY(' + (-(1 - fade) * 26).toFixed(1) + 'px)';
  }
}

function onScroll(){
  onDirection();
  if (!ticking){ ticking = true; requestAnimationFrame(update); }
}

/** First frame immediately, the rest in the background a few at a time. */
async function preload(){
  await load(0);
  draw(0);
  const CONCURRENCY = 6;
  let next = 1;
  await Promise.all(new Array(CONCURRENCY).fill(0).map(async () => {
    while (next < FRAME_COUNT){
      const i = next++;
      await load(i);
      if (i === lastDrawn) draw(i);      // repaint if the reader is already there
    }
  }));
  update();
}

if (canvas){
  canvas.width = 900;
  canvas.height = 506;                   // CSS object-fit does the cropping
  ctx = canvas.getContext('2d', { alpha:false });
  ctx.fillStyle = '#080808';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  preload();
}

window.addEventListener('scroll', onScroll, { passive:true });
window.addEventListener('resize', () => { lastDrawn = -1; update(); }, { passive:true });
onScroll();

/* ================= treadmill =================
 * The loop only looks seamless because the track holds two identical copies and
 * the animation travels exactly half its width.
 */
document.querySelectorAll('.btrack').forEach(track => {
  const original = track.innerHTML;
  track.innerHTML = original + original;
});

/* ================= staged reveals =================
 * Not one-shot: the class comes off again once a block has fully left, so the
 * sequence replays every time you scroll back to it.
 */
const io = 'IntersectionObserver' in window
  ? new IntersectionObserver(entries => {
      for (const e of entries){
        if (e.isIntersecting) e.target.classList.add('in');
        // only reset once it is properly gone, or it flickers at the edges
        else if (e.boundingClientRect.top > window.innerHeight ||
                 e.boundingClientRect.bottom < 0) e.target.classList.remove('in');
      }
    }, { rootMargin:'0px 0px -10% 0px', threshold:[0, 0.08] })
  : null;

document.querySelectorAll('[data-reveal]').forEach(n => {
  if (io) io.observe(n); else n.classList.add('in');
});

})();
