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

const reducedMotion = !!(window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches);

const nav      = document.getElementById('nav');
const navLinks = document.getElementById('navlinks');
const navToggle= document.getElementById('navtoggle');
const hero     = document.getElementById('hero');
const canvas   = document.getElementById('heroframes');
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

    const landing = document.getElementById('landing');
    const buried = landing && landing.classList.contains('hide');

    if (!buried){
      target.scrollIntoView({ behavior:'smooth', block:'start' });
      return;
    }

    /* A tool is open, so the section is inside a hidden container: scrolling to
       it would do nothing at all. Clear the hash to send the router back to the
       landing page, then scroll once it has actually swapped the view in.
       Waiting on hashchange rather than a timer means no guessed delay. */
    const afterSwap = () => {
      window.removeEventListener('hashchange', afterSwap);
      requestAnimationFrame(() => {
        target.scrollIntoView({ behavior:'smooth', block:'start' });
      });
    };
    window.addEventListener('hashchange', afterSwap);
    location.hash = '';
  });
});

/* ================= the dissolving lede =================
 * The copy used to fade out as one block while the frames took over. Taking it
 * away a letter at a time, from the end backwards, makes the hero feel like it
 * is being consumed by the footage rather than merely dimmed.
 *
 * Letters are wrapped individually but words are kept whole, so the paragraph
 * still wraps on spaces the way any other text does. Reverse document order is
 * what produces "from the bottom": the last line goes first, unravelling from
 * its end, and the sentence retreats upward toward the headline.
 */
const lede = hero && hero.querySelector('.lede');
let glyphs = [];          // reverse order: [0] is the last letter on the page
let hiddenCount = -1;

function splitLede(){
  if (!lede || reducedMotion) return;
  const text = lede.textContent.replace(/\s+/g, ' ').trim();
  if (!text) return;

  const frag = document.createDocumentFragment();
  text.split(' ').forEach((word, i, all) => {
    const w = document.createElement('span');
    w.className = 'wd';
    for (const ch of word){
      const c = document.createElement('span');
      c.className = 'ch';
      c.textContent = ch;
      w.appendChild(c);
    }
    frag.appendChild(w);
    // a real space between words, so wrapping stays the browser's job
    if (i < all.length - 1) frag.appendChild(document.createTextNode(' '));
  });

  lede.textContent = '';
  lede.appendChild(frag);
  lede.classList.add('is-split');
  glyphs = [].slice.call(lede.querySelectorAll('.ch')).reverse();
}

/* Where in the scrub the sentence comes apart. It finishes before the block
   fade at .60 takes the headline, so the two never run at once. */
const DISSOLVE_FROM = 0.12, DISSOLVE_TO = 0.55;

function dissolve(progress){
  if (!glyphs.length) return;
  const t = (progress - DISSOLVE_FROM) / (DISSOLVE_TO - DISSOLVE_FROM);
  const want = Math.round(Math.min(1, Math.max(0, t)) * glyphs.length);
  if (want === hiddenCount) return;

  /* Only the letters that actually changed are touched. Writing a style to
     every glyph on every frame would be a few hundred writes per frame for a
     handful of visible changes. */
  if (want > hiddenCount){
    for (let i = Math.max(0, hiddenCount); i < want; i++) glyphs[i].classList.add('gone');
  } else {
    for (let i = hiddenCount - 1; i >= want; i--) glyphs[i].classList.remove('gone');
  }
  hiddenCount = want;
}

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
  // the sentence comes apart first, then what is left steps aside
  dissolve(progress);
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

splitLede();
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
const reduced = reducedMotion;

/* ---- masked headings ----------------------------------------------------
 * Wrapping each line in its own clipped box lets it rise out from behind an
 * edge instead of fading in place. Done here rather than in the markup so the
 * HTML stays readable and a script failure just leaves ordinary headings. */
function maskLines(el){
  if (el.dataset.masked) return;
  el.dataset.masked = '1';
  const lines = el.innerHTML.split(/<br\s*\/?>/i);
  el.innerHTML = lines.map((line, i) =>
    '<span class="mln" style="--i:' + i + '"><span>' + line + '</span></span>'
  ).join('');
  el.classList.add('is-masked');
}
document.querySelectorAll('.hero .display, .sechead h2').forEach(maskLines);

/* ---- sequenced children -------------------------------------------------
 * The stat boxes and the ten tool cards used to share a single trigger and so
 * arrived all at once. Stamping an index on each child lets one CSS rule walk
 * them in one at a time. */
document.querySelectorAll('[data-seq]').forEach(box => {
  Array.prototype.forEach.call(box.children, (child, i) =>
    child.style.setProperty('--i', i));
});

/* ---- counting numerals --------------------------------------------------
 * The figures read as claims when they are simply printed; watching one climb
 * makes it read as a measurement. Suffixes are kept, so 100% still ends in a
 * percent sign, and the final frame is the original text rather than something
 * the easing rounded to. */
const COUNT_MS = 1600;
const easeOutExpo = t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

document.querySelectorAll('.stats b').forEach(b => {
  const m = b.textContent.trim().match(/^([\d.,]+)(.*)$/);
  if (!m) return;
  b.dataset.final  = b.textContent.trim();
  b.dataset.target = m[1].replace(/,/g, '');
  b.dataset.suffix = m[2] || '';
});

function count(b){
  const target = parseFloat(b.dataset.target);
  if (!isFinite(target)) return;
  // counting up to nothing is a non-event: "0 bytes uploaded" is the whole point
  if (reduced || target === 0){ b.textContent = b.dataset.final; return; }

  cancelAnimationFrame(b._raf);
  const decimals = (b.dataset.target.split('.')[1] || '').length;
  const started  = performance.now();

  const frame = now => {
    const p = Math.min(1, (now - started) / COUNT_MS);
    if (p < 1){
      const v = target * easeOutExpo(p);
      b.textContent = (decimals ? v.toFixed(decimals)
                                : Math.round(v).toLocaleString()) + b.dataset.suffix;
      b._raf = requestAnimationFrame(frame);
    } else {
      b.textContent = b.dataset.final;
    }
  };
  b.textContent = '0' + b.dataset.suffix;
  b._raf = requestAnimationFrame(frame);
}

/* ---- which way the reader is travelling ---------------------------------
 * A block that left over the top should return from the top, not rise from
 * below. The side it exited on is recorded as it goes, and the sign is read
 * back by the CSS through an inherited custom property. */
function park(el, sign){
  el.style.setProperty('--rv', (sign * 16) + 'px');
  el.style.setProperty('--mln', (sign * 112) + '%');
}

const io = 'IntersectionObserver' in window
  ? new IntersectionObserver(entries => {
      for (const e of entries){
        const el = e.target;
        if (e.isIntersecting){
          el.classList.add('in');
          if (el.classList.contains('stats')) el.querySelectorAll('b').forEach(count);
        }
        // only reset once it is properly gone, or it flickers at the edges
        else if (e.boundingClientRect.top > window.innerHeight){
          el.classList.remove('in'); park(el, 1);    // left below: it will rise
        } else if (e.boundingClientRect.bottom < 0){
          el.classList.remove('in'); park(el, -1);   // left above: it will descend
        }
      }
    }, { rootMargin:'0px 0px -10% 0px', threshold:[0, 0.08] })
  : null;

document.querySelectorAll('[data-reveal]').forEach(n => {
  // The hero belongs to the overture below. Left to the observer it would open
  // on the first frame -- before the fonts land, and ahead of the nav that is
  // supposed to lead it.
  if (n === hero) return;
  if (io) io.observe(n); else n.classList.add('in');
});

/* ================= the overture =================
 * The bar frames the page, so it arrives first and the hero follows underneath
 * it. Waiting on the webfonts means the headline rises already set in the
 * serif rather than swapping face mid-movement; the timeout is there because a
 * font that never resolves must not cost us the whole opening. */
function overture(){
  if (nav) nav.classList.add('lit');
  if (hero) hero.classList.add('in');
}
let opened = false;
const openOnce = () => { if (!opened){ opened = true; overture(); } };

if (document.fonts && document.fonts.ready){
  document.fonts.ready.then(() => requestAnimationFrame(openOnce));
  setTimeout(openOnce, 900);
} else {
  requestAnimationFrame(openOnce);
}

})();
