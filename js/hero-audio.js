/* hero-audio.js — the riser plays once through, triggered by the hero.
 *
 * Start scrolling the hero and it begins at the first note. From then on it runs
 * to its own end without interruption, whether you keep scrolling, slow down or
 * stop entirely. Scroll back to the top and it rewinds, ready to run again.
 *
 * It deliberately does NOT track scroll position. An earlier version scrubbed
 * currentTime to the frame progress and paused whenever the page stopped moving,
 * which was accurate but meant the riser broke up every time you paused to read.
 * A riser is a single gesture; chopping it into pieces ruins it.
 *
 * THE ONE THING THAT CANNOT BE ENGINEERED AWAY
 * No browser lets a page make a sound until the visitor has clicked, tapped or
 * typed on it. Scrolling never counts. So this spends the first such gesture by
 * playing once while muted, which leaves the element unblocked without the
 * arming itself being audible. Before that gesture it is silent, and no code can
 * change that.
 *
 * SELF-CONTAINED. To remove the feature: delete this file, its one script tag in
 * index.html, and assets/hero-riser.mp3. Nothing else refers to any of it.
 */
(function () {
'use strict';

const hero = document.getElementById('hero');
if (!hero) return;                     // landing page only

const VOLUME  = 0.55;   // a riser at full scale is startling
const FADE_MS = 260;    // gentle enough that the entry is not a jump cut
const BEGIN   = 0.004;  // progress at which the frames are clearly moving

const audio = new Audio('assets/hero-riser.mp3');
audio.preload = 'auto';
audio.volume = 0;

let started = false, fade = 0, ticking = false;
let armed = false, errs = 0, told = false, told2 = false;

audio.addEventListener('error', () => {
  errs++;
  const e = audio.error;
  console.warn('[hero-audio] cannot load assets/hero-riser.mp3' +
               (e ? ' (code ' + e.code + ')' : '') +
               ' — check it is served as audio/mpeg.');
});
audio.addEventListener('canplay', () => {
  if (!told){ told = true; console.info('[hero-audio] ready, ' +
    (audio.duration || 0).toFixed(1) + 's — click anywhere once, then scroll.'); }
});

/* ================= arming ================= */
const GESTURES = ['pointerdown', 'touchstart', 'keydown', 'click'];

function arm(){
  if (armed || errs >= 3) return;
  audio.muted = true;
  const p = audio.play();
  if (!p || !p.then){ finishArming(); return; }
  p.then(() => {
    audio.pause();
    audio.currentTime = 0;
    audio.muted = false;
    finishArming();
  }).catch(() => { audio.muted = false; });   // still blocked; keep listening
}
function finishArming(){
  armed = true;
  GESTURES.forEach(t => removeEventListener(t, arm));
}
GESTURES.forEach(t => addEventListener(t, arm, { passive:true }));

/* ================= progress, exactly as the frames read it ================= */
function progress(){
  const rect  = hero.getBoundingClientRect();
  const total = rect.height - innerHeight;
  return total <= 0 ? 0 : Math.min(1, Math.max(0, -rect.top / total));
}

function ramp(to, done){
  clearInterval(fade);
  const from = audio.volume, steps = Math.max(1, Math.round(FADE_MS / 20));
  let n = 0;
  fade = setInterval(() => {
    n++;
    audio.volume = Math.min(1, Math.max(0, from + (to - from) * (n / steps)));
    if (n >= steps){ clearInterval(fade); if (done) done(); }
  }, 20);
}

function begin(){
  started = true;
  try { audio.currentTime = 0; } catch (e) {}
  const play = audio.play();
  if (play && play.catch) play.catch(() => {
    started = false;                     // blocked: let the next scroll try again
    if (!told2){ told2 = true;
      console.info('[hero-audio] blocked until you click the page once — ' +
                   'browsers never allow sound from scrolling alone.'); }
  });
  ramp(VOLUME);
}

function rewind(){
  started = false;
  clearInterval(fade);
  audio.volume = 0;
  try { audio.pause(); audio.currentTime = 0; } catch (e) {}
}

function onScroll(){
  if (errs >= 3) return;
  const p = progress();

  // Back above the hero: reset so the next descent starts it cleanly again.
  if (p <= 0){ if (started) rewind(); return; }

  // First real movement of the frames starts it, and nothing stops it after.
  if (!started && p >= BEGIN) begin();
}

addEventListener('scroll', () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => { ticking = false; onScroll(); });
}, { passive:true });

/* A hidden tab is paused by the browser anyway; pick the riser back up where it
   left off rather than losing the rest of it. */
document.addEventListener('visibilitychange', () => {
  if (!started) return;
  if (document.hidden){ try { audio.pause(); } catch (e) {} }
  else if (audio.currentTime > 0 && !audio.ended){
    const play = audio.play();
    if (play && play.catch) play.catch(() => {});
  }
});

})();
