/* landing.js — floating navigation, the scroll-scrubbed frame sequence, and
 * the reveal transitions.
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

/* ================= floating nav ================= */
let stuck = false;
function onScrollNav(){
  const should = window.scrollY > 24;
  if (should !== stuck){
    stuck = should;
    nav.classList.toggle('stuck', stuck);
  }
}
if (navToggle){
  navToggle.onclick = () => navLinks.classList.toggle('open');
  navLinks.addEventListener('click', e => {
    if (e.target.tagName === 'A') navLinks.classList.remove('open');
  });
}

/* in-page anchors scroll smoothly; everything else is left alone */
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
  // the words step aside for the footage, then come back for the closing line
  if (heroInner){
    const fade = progress < 0.55 ? 1 : Math.max(0, 1 - (progress - 0.55) / 0.3);
    heroInner.style.opacity = fade.toFixed(3);
    heroInner.style.transform = 'translateY(' + (-(1 - fade) * 26).toFixed(1) + 'px)';
  }
}

function onScroll(){
  onScrollNav();
  if (!ticking){ ticking = true; requestAnimationFrame(update); }
}

/** First frame immediately, the rest in the background a few at a time. */
async function preload(){
  await load(0);
  draw(0);
  const CONCURRENCY = 6;
  let next = 1;
  const workers = new Array(CONCURRENCY).fill(0).map(async () => {
    while (next < FRAME_COUNT){
      const i = next++;
      await load(i);
      if (i === lastDrawn) draw(i);       // repaint if the user already scrolled here
    }
  });
  await Promise.all(workers);
  update();
}

if (canvas){
  canvas.width = 900;
  canvas.height = 506;                    // CSS object-fit does the cropping
  ctx = canvas.getContext('2d', { alpha:false });
  ctx.fillStyle = '#080808';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  preload();
}

window.addEventListener('scroll', onScroll, { passive:true });
window.addEventListener('resize', () => { lastDrawn = -1; update(); }, { passive:true });
onScroll();

/* ================= reveal on entry ================= */
const io = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
      for (const e of entries){
        if (!e.isIntersecting) continue;
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    }, { rootMargin:'0px 0px -12% 0px', threshold:0.05 })
  : null;

document.querySelectorAll('[data-reveal]').forEach((n, i) => {
  // a short stagger inside a group, capped so nothing ever feels slow
  n.style.transitionDelay = Math.min(i % 6, 5) * 70 + 'ms';
  if (io) io.observe(n); else n.classList.add('in');
});

})();
