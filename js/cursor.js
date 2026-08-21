/* cursor.js — a glass bubble that follows the pointer, and the wave it leaves.
 *
 * The bubble runs on every page. The wave runs on the landing page only, and
 * only while the landing view is actually showing: a tool panel is a working
 * surface, and ripples across a timeline would be noise.
 *
 * WHY THE BUBBLE HIDES ITSELF SOMETIMES
 * Some cursors carry information rather than decoration -- grab on a clip,
 * ew-resize on a trim handle, crosshair on the watermark stage, the I-beam in a
 * field. The stylesheet keeps those and hides the rest. Rather than repeat that
 * list here and let the two drift apart, this file asks the browser: on entering
 * an element, if its computed cursor is not 'none', the real cursor is visible,
 * so the bubble steps aside. One source of truth, in the CSS.
 *
 * Turned off entirely for touch, for pointers that cannot hover, and for anyone
 * who asked for reduced motion -- in those cases nothing is injected at all and
 * the normal cursor is untouched.
 */
(function () {
'use strict';

/* DESKTOP ONLY, AND CHECKED TWICE.
   pointer:fine means the primary pointer is a mouse, trackpad or stylus;
   hover:hover means it can rest over a thing without committing to it. Phones
   and tablets fail both, so nothing below ever runs there -- no elements are
   injected and the ordinary cursor is left completely alone. A laptop with a
   touch screen still passes, which is right: it has a trackpad. */
const mqFine  = matchMedia('(pointer:fine)');
const mqHover = matchMedia('(hover:hover)');
const calm    = matchMedia('(prefers-reduced-motion:reduce)').matches;
const desktop = () => mqFine.matches && mqHover.matches;
if (!desktop() || calm) return;

const root    = document.documentElement;
const landing = document.getElementById('landing');   // absent off the landing page
const WAVES   = !!document.getElementById('hero');    // landing page only

/* ================= the bubble ================= */
const bubble = document.createElement('div');
bubble.className = 'gcur';
bubble.setAttribute('aria-hidden', 'true');
bubble.innerHTML = '<i class="gcur-sheen"></i><i class="gcur-rim"></i>';

const dot = document.createElement('div');        // the precise point, no lag
dot.className = 'gcur-dot';
dot.setAttribute('aria-hidden', 'true');

document.body.appendChild(bubble);
document.body.appendChild(dot);
root.classList.add('gcur-on');                    // this is what hides the real cursor

/* ================= the wave ================= */
let cvs = null, ctx = null, dpr = 1;
if (WAVES){
  cvs = document.createElement('canvas');
  cvs.className = 'gcur-wave';
  cvs.setAttribute('aria-hidden', 'true');
  document.body.appendChild(cvs);
  ctx = cvs.getContext('2d');
  sizeCanvas();
  addEventListener('resize', sizeCanvas, { passive:true });
}
function sizeCanvas(){
  if (!cvs) return;
  dpr = Math.min(devicePixelRatio || 1, 2);       // 2 is plenty; 3 just costs fill rate
  cvs.width  = Math.round(innerWidth  * dpr);
  cvs.height = Math.round(innerHeight * dpr);
  cvs.style.width  = innerWidth  + 'px';
  cvs.style.height = innerHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/* ================= state ================= */
let tx = innerWidth / 2, ty = innerHeight / 2;    // where the pointer is
let bx = tx, by = ty;                             // where the bubble has got to
let px = tx, py = ty;                             // pointer last frame, for velocity
let lastX = tx, lastY = ty;                       // last ripple seeded here
let vx = 0, vy = 0;
let shown = false, over = false, down = false;
let running = false;

const rings = [];
const MAX_RINGS = 64;
const STEP      = 24;      // px of travel between ripples
const EASE      = 0.19;    // how hard the bubble chases the pointer

/* ================= input ================= */
addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
  tx = e.clientX; ty = e.clientY;
  if (!shown){ shown = true; bubble.classList.add('in'); dot.classList.add('in'); }
  seed();
  kick();
}, { passive:true });

/* The real cursor is visible here, so stand down. Fires on element change
   rather than every move, so the computed-style read is cheap. */
addEventListener('pointerover', e => {
  const el = e.target;
  if (!el || el.nodeType !== 1) return;
  const native = getComputedStyle(el).cursor !== 'none';
  bubble.classList.toggle('off', native);
  dot.classList.toggle('off', native);
  over = !!el.closest('a,button,summary,label,[role="button"],[data-go],[data-scroll],input,select,textarea');
  bubble.classList.toggle('hot', over && !native);
}, { passive:true });

addEventListener('pointerdown', () => { down = true;  bubble.classList.add('press'); }, { passive:true });
addEventListener('pointerup',   () => { down = false; bubble.classList.remove('press'); }, { passive:true });

addEventListener('pointerleave', hide, { passive:true });
document.addEventListener('mouseleave', hide);
document.addEventListener('mouseenter', () => {
  shown = true; bubble.classList.add('in'); dot.classList.add('in');
});
function hide(){ shown = false; bubble.classList.remove('in'); dot.classList.remove('in'); }

/* ================= ripples ================= */
function wavesLive(){
  if (!WAVES) return false;
  // a tool panel is open -> the landing page is hidden -> no ripples
  return !(landing && landing.classList.contains('hide'));
}

function seed(){
  if (!wavesLive() || bubble.classList.contains('off')) return;
  const dx = tx - lastX, dy = ty - lastY;
  const d  = Math.hypot(dx, dy);
  if (d < STEP) return;

  // Walk the gap so a fast flick still leaves an even trail rather than gaps.
  const n = Math.min(Math.floor(d / STEP), 4);
  for (let i = 1; i <= n; i++){
    const t = i / n;
    push(lastX + dx * t, lastY + dy * t, Math.min(d / STEP, 3));
  }
  lastX = tx; lastY = ty;
}

function push(x, y, force){
  if (rings.length >= MAX_RINGS) rings.shift();
  rings.push({ x, y, r: 6, life: 1, force: Math.min(force, 3) });
}

/* a click drops a bigger, slower ring */
addEventListener('pointerdown', e => {
  if (!wavesLive() || bubble.classList.contains('off')) return;
  if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
  push(e.clientX, e.clientY, 3.4);
  push(e.clientX, e.clientY, 2.0);
}, { passive:true });

/* ================= the loop ================= */
function kick(){ if (!running){ running = true; requestAnimationFrame(frame); } }

function frame(){
  /* --- bubble: chase, then squash along the direction of travel --- */
  bx += (tx - bx) * EASE;
  by += (ty - by) * EASE;

  vx = tx - px; vy = ty - py;
  px = tx; py = ty;

  const speed   = Math.hypot(vx, vy);
  const stretch = Math.min(speed / 130, 0.34);      // liquid, not rubbery
  const ang     = Math.atan2(by - ty, bx - tx) * 180 / Math.PI;

  bubble.style.transform =
    'translate3d(' + bx + 'px,' + by + 'px,0) rotate(' + ang + 'deg) ' +
    'scale(' + (1 + stretch) + ',' + (1 - stretch * 0.62) + ')';
  dot.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0)';

  /* --- wave --- */
  if (ctx){
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    if (rings.length){
      ctx.globalCompositeOperation = 'lighter';
      for (let i = rings.length - 1; i >= 0; i--){
        const r = rings[i];
        r.r    += 1.9 + r.force * 0.8;
        r.life -= 0.017;
        if (r.life <= 0){ rings.splice(i, 1); continue; }

        const a = r.life * r.life * 0.30;           // squared, so it fades out softly
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(198,161,91,' + a + ')';
        ctx.lineWidth   = Math.max(0.4, 1.9 * r.life);
        ctx.stroke();

        // a paler ring just inside gives the crest some thickness
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r * 0.82, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,' + (a * 0.42) + ')';
        ctx.lineWidth   = Math.max(0.3, 1.1 * r.life);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  /* Stop once everything has settled, so an idle tab costs nothing. */
  const moving = Math.abs(tx - bx) > 0.1 || Math.abs(ty - by) > 0.1;
  if (moving || rings.length){ requestAnimationFrame(frame); }
  else { running = false; }
}

kick();

/* If the primary pointer stops being a mouse -- a tablet undocked from its
   keyboard, a responsive-design preview, a mouse unplugged -- pull everything
   back out and hand the real cursor over. */
function teardown(){
  root.classList.remove('gcur-on');
  bubble.remove(); dot.remove();
  if (cvs) cvs.remove();
  rings.length = 0;
}
const watch = () => { if (!desktop()) teardown(); };
if (mqFine.addEventListener){
  mqFine.addEventListener('change', watch);
  mqHover.addEventListener('change', watch);
}

})();
