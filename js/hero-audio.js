/* hero-audio.js — the riser loops through the hero, triggered by the frames.
 *
 * It starts just after the first frame, loops for as long as you are inside the
 * hero, and stops when the last frame is reached. Pausing partway through does
 * not interrupt it -- the loop keeps running until you arrive at the end frame
 * or climb back above the hero.
 *
 * The clip is 13.5s and the hero is 340vh, so a slow reader would otherwise run
 * out of sound long before the frames ran out. Looping is what covers the gap.
 * It deliberately does NOT scrub currentTime to scroll position: an earlier
 * version did, and it broke the riser into fragments every time you paused.
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
const FADE_MS = 260;    // gentle enough that neither edge is a jump cut
const BEGIN   = 0.004;  // just past the first frame, once the frames are moving
const END     = 0.999;  // the last frame; float maths never quite reaches 1

const audio = new Audio('assets/hero-riser.mp3');
audio.preload = 'auto';
audio.loop = true;      // one clip cannot cover 340vh of scrolling on its own
audio.volume = 0;

let playing = false, fade = 0, ticking = false;
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

function start(){
  playing = true;
  const play = audio.play();
  if (play && play.catch) play.catch(() => {
    playing = false;                     // blocked: let the next scroll try again
    if (!told2){ told2 = true;
      console.info('[hero-audio] blocked until you click the page once — ' +
                   'browsers never allow sound from scrolling alone.'); }
  });
  ramp(VOLUME);
}

/* Fade rather than cut, so arriving at the last frame is a landing and not a
   slammed door. rewind only when leaving over the top, where the next descent
   should hear the riser from its opening again. */
function halt(rewind){
  if (!playing){
    /* Already stopped. Do not start another fade on every scroll event up here;
       just make sure a descent from the top begins at the opening note. */
    if (rewind && audio.currentTime !== 0){
      try { audio.currentTime = 0; } catch (e) {}
    }
    return;
  }
  playing = false;
  ramp(0, () => {
    try {
      audio.pause();
      if (rewind) audio.currentTime = 0;
    } catch (e) {}
  });
}

function onScroll(){
  if (errs >= 3) return;
  const p = progress();

  if (p <= 0){ halt(true);  return; }   // back above the hero
  if (p >= END){ halt(false); return; }  // the last frame: this is the end of it

  if (!playing && p >= BEGIN) start();
}

addEventListener('scroll', () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => { ticking = false; onScroll(); });
}, { passive:true });

/* A hidden tab is paused by the browser anyway; pick the riser back up where it
   left off rather than losing the rest of it. */
document.addEventListener('visibilitychange', () => {
  if (!playing) return;
  if (document.hidden){ try { audio.pause(); } catch (e) {} }
  else {
    const play = audio.play();
    if (play && play.catch) play.catch(() => {});
  }
});

})();
