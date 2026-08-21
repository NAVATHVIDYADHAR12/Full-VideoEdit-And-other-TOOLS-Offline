/* =============================================================================
 *  hero-scroll.js
 *  A drop-in scroll-reveal hero: your video plays frame by frame as the
 *  visitor scrolls, with your headline sitting on top of it.
 *
 *  HOW TO USE  — two lines of HTML, nothing else.
 *
 *      <section id="hero">
 *        <h1>Your headline</h1>
 *        <p>Your supporting line.</p>
 *      </section>
 *
 *      <script src="hero-scroll.js"></script>
 *
 *  This file builds the canvas, writes its own CSS and runs the animation.
 *  Whatever you put inside #hero stays as the overlaid content.
 *
 *  FRAMES: run prepare_frames.py first. It creates assets/hero/f001.jpg …
 *  and prints the two settings to paste below.
 * ========================================================================== */

(function () {
'use strict';

/* =============================================================================
 *                          >>>  EDIT THIS BLOCK  <<<
 * ========================================================================== */

var CONFIG = {

  /* -------------------------------------------------------------------------
   *  1. WHERE YOUR FRAMES LIVE
   *
   *     The folder holding your f001.jpg, f002.jpg … files.
   *     This is the same folder prepare_frames.py wrote to.
   *     No slash at the end.
   * ---------------------------------------------------------------------- */
  folder: 'assets/hero',

  /* -------------------------------------------------------------------------
   *  2. HOW MANY FRAMES THERE ARE
   *
   *     prepare_frames.py prints this number when it finishes. Paste it here.
   *     Or leave it as 'auto' and this script will work it out itself
   *     (costs a handful of extra requests once, on first load).
   * ---------------------------------------------------------------------- */
  count: 'auto',

  /* -------------------------------------------------------------------------
   *  3. HOW THEY ARE NAMED
   *     Defaults match prepare_frames.py. Only change these if you renamed
   *     the files yourself.  f + 001 + .jpg
   * ---------------------------------------------------------------------- */
  prefix: 'f',
  pad: 3,
  ext: 'jpg',

  /* -------------------------------------------------------------------------
   *  4. HOW LONG THE EFFECT LASTS
   *
   *     How much scrolling plays the whole sequence, in screen-heights.
   *       300 = about three screens   (default, unhurried)
   *       200 = quicker, punchier
   *       450 = slow and cinematic
   *     Tune this LAST, once everything else works.
   * ---------------------------------------------------------------------- */
  scrollLength: 340,

  /* -------------------------------------------------------------------------
   *  5. LOOK
   *
   *     frameOpacity  how visible the footage is behind your text.
   *                   0.34 keeps text comfortably readable. Above ~0.5 it
   *                   starts to fight the words.
   *     background    the page colour the frames fade into at the edges.
   *                   Set this to your own site background.
   * ---------------------------------------------------------------------- */
  frameOpacity: 0.34,
  background: '#080808',

  /* -------------------------------------------------------------------------
   *  6. THE SECTION TO TAKE OVER
   *     Change only if your section uses a different id.
   * ---------------------------------------------------------------------- */
  heroId: 'hero'
};

/* =============================================================================
 *                       >>>  STOP EDITING HERE  <<<
 * ========================================================================== */


/* ---- find the section, and refuse politely if it is not there ----------- */
var hero = document.getElementById(CONFIG.heroId);
if (!hero) {
  console.warn('[hero-scroll] No element with id "' + CONFIG.heroId +
               '" was found, so the hero did nothing. Add <section id="' +
               CONFIG.heroId + '">…</section> to your page.');
  return;
}

var reduced = window.matchMedia &&
              window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function framePath(n) {
  var s = String(n);
  while (s.length < CONFIG.pad) s = '0' + s;
  return CONFIG.folder + '/' + CONFIG.prefix + s + '.' + CONFIG.ext;
}

/* ---- build the structure around whatever content is already inside ------ */
var inner = document.createElement('div');
inner.className = 'hs-inner';
while (hero.firstChild) inner.appendChild(hero.firstChild);   // keep their content

var canvas = document.createElement('canvas');
canvas.className = 'hs-canvas';
canvas.setAttribute('aria-hidden', 'true');                   // decoration only

var veil = document.createElement('div');
veil.className = 'hs-veil';
veil.setAttribute('aria-hidden', 'true');

var stage = document.createElement('div');
stage.className = 'hs-stage';
stage.appendChild(canvas);
stage.appendChild(veil);
stage.appendChild(inner);

hero.classList.add('hs-hero');
hero.appendChild(stage);

/* ---- its own stylesheet, so there is no second file to remember --------- */
var css =
  '.hs-hero{position:relative;height:' + (reduced ? 100 : CONFIG.scrollLength) + 'vh}' +
  '.hs-stage{position:sticky;top:0;height:100vh;overflow:hidden;' +
    'display:flex;align-items:center;justify-content:center;' +
    'background:' + CONFIG.background + '}' +
  '.hs-canvas{position:absolute;inset:0;width:100%;height:100%;' +
    'object-fit:cover;opacity:' + CONFIG.frameOpacity + '}' +
  /* keeps the words readable over even the brightest frame */
  '.hs-veil{position:absolute;inset:0;pointer-events:none;background:' +
    'radial-gradient(120% 90% at 50% 40%,transparent 0%,rgba(0,0,0,.5) 55%,' +
      CONFIG.background + ' 100%),' +
    'linear-gradient(180deg,rgba(0,0,0,.55) 0%,transparent 22%,transparent 70%,' +
      CONFIG.background + ' 100%)}' +
  '.hs-inner{position:relative;z-index:2;text-align:center;' +
    'width:min(1100px,calc(100% - 48px));margin:0 auto}';

var style = document.createElement('style');
style.textContent = css;
document.head.appendChild(style);

/* ---- canvas set up ONCE: assigning width/height reallocates it ---------- */
var ctx = canvas.getContext('2d', { alpha: false });
var sized = false;

function sizeCanvasTo(img) {
  if (sized) return;
  canvas.width = img.naturalWidth || 900;
  canvas.height = img.naturalHeight || 506;   // CSS object-fit does the cropping
  sized = true;
}

ctx.fillStyle = CONFIG.background;
ctx.fillRect(0, 0, canvas.width, canvas.height);

/* ---- loading ------------------------------------------------------------ */
var images = [];
var frameCount = 0;
var lastDrawn = -1;
var ticking = false;

function loadOne(i) {
  return new Promise(function (resolve) {
    var img = new Image();
    img.onload = function () { images[i] = img; resolve(img); };
    img.onerror = function () { resolve(null); };   // one gap must not stall the rest
    img.src = framePath(i + 1);
  });
}

function exists(n) {
  return new Promise(function (resolve) {
    var img = new Image();
    img.onload = function () { resolve(true); };
    img.onerror = function () { resolve(false); };
    img.src = framePath(n);
  });
}

/* Work out how many frames there are without asking for all of them:
   double until one is missing, then binary search the gap. */
async function detectCount() {
  if (!(await exists(1))) return 0;
  var lo = 1, hi = 2;
  while (hi <= 1024 && await exists(hi)) { lo = hi; hi *= 2; }
  while (lo + 1 < hi) {
    var mid = Math.floor((lo + hi) / 2);
    if (await exists(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

/* ---- drawing ------------------------------------------------------------ */
function nearestLoaded(i) {
  if (images[i]) return images[i];
  for (var d = 1; d < frameCount; d++) {
    if (images[i - d]) return images[i - d];
    if (images[i + d]) return images[i + d];
  }
  return null;
}

function draw(i) {
  var img = nearestLoaded(i);
  if (!img) return;
  sizeCanvasTo(img);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
}

function update() {
  ticking = false;
  if (!frameCount) return;

  var rect = hero.getBoundingClientRect();
  if (rect.height === 0) return;              // hidden: compute nothing

  var travel = rect.height - window.innerHeight;
  var progress = travel <= 0 ? 0 : Math.min(1, Math.max(0, -rect.top / travel));

  var i = Math.min(frameCount - 1, Math.round(progress * (frameCount - 1)));
  if (i !== lastDrawn) { lastDrawn = i; draw(i); }   // skip repeat indices
}

function onScroll() {
  // scroll fires far more often than the screen refreshes; collapse the burst
  if (!ticking) { ticking = true; requestAnimationFrame(update); }
}

/* ---- start -------------------------------------------------------------- */
async function start() {
  frameCount = CONFIG.count === 'auto' ? await detectCount() : CONFIG.count;

  if (!frameCount) {
    console.warn('[hero-scroll] No frames found at "' + framePath(1) + '". ' +
                 'Run prepare_frames.py, or check the folder setting.');
    return;
  }
  images = new Array(frameCount).fill(null);

  // first frame immediately, so the hero is never blank
  await loadOne(0);
  draw(0);

  if (reduced) return;    // one still frame is the whole effect in that mode

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', function () { lastDrawn = -1; update(); },
                          { passive: true });
  onScroll();

  // the rest in the background, a few at a time: one by one wastes the
  // connection, all at once starves the fonts and stylesheets
  var next = 1;
  await Promise.all(new Array(6).fill(0).map(async function () {
    while (next < frameCount) {
      var i = next++;
      await loadOne(i);
      if (i === lastDrawn) draw(i);       // repaint if the reader is already here
    }
  }));
  update();
}

start();

})();
