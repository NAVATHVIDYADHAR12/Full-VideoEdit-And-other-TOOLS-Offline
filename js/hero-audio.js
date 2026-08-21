/* hero-audio.js — a riser scrubbed by the hero frames. No control, no UI.
 *
 * Scroll the hero and it sounds; stop and it stops. The clip is 13.5s and the
 * hero is 340vh, so currentTime = progress * duration and the riser lands on its
 * last note exactly as frame 080 draws. Progress is read the same way
 * landing.js reads it for the frames, so the two cannot drift apart.
 *
 * THE ONE THING THAT CANNOT BE ENGINEERED AWAY
 * No browser will let a page make a sound until the visitor has interacted with
 * it -- a click, a tap or a key. Scrolling does not count, on any browser. So
 * this arms itself on the first such gesture anywhere on the page and is silent
 * before then. Nothing can change that; it is a deliberate protection against
 * pages that shout at you on arrival. In practice: click once, then scroll.
 *
 * SELF-CONTAINED. To remove the feature: delete this file, its one script tag in
 * index.html, and assets/hero-riser.mp3. Nothing else refers to any of it.
 */
(function () {
'use strict';

const hero = document.getElementById('hero');
if (!hero) return;                     // landing page only

const VOLUME  = 0.55;   // a riser at full scale is startling
const DRIFT   = 0.35;   // seconds out of step before re-seeking is worth it
const IDLE_MS = 170;    // silence this long after scrolling stops
const FADE_MS = 120;    // enough to kill the click at each edge

const audio = new Audio('assets/hero-riser.mp3');
audio.preload = 'auto';
audio.volume = 0;

let armed = false, idle = 0, fade = 0, ticking = false;
let errs = 0, told = false, told2 = false;

/* Say what went wrong. The first version failed silently, which is how a
   missing MIME type on the local server passed for "the audio does not work".
   A served octet-stream will not decode in <audio> however valid the file. */
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
/* Play once while muted: that is what spends the user's gesture and leaves the
   element unblocked for later. Doing it silently means the click that unlocks
   it is never itself audible. */
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
  }).catch(() => {
    audio.muted = false;          // still blocked; leave the listeners in place
  });
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

function stop(){
  clearTimeout(idle);
  if (audio.paused){ audio.volume = 0; return; }
  ramp(0, () => { try { audio.pause(); } catch (e) {} });
}

function sync(){
  const p = progress();

  // above the hero, or past it: silence, and rewind ready for the next pass
  if (p <= 0 || p >= 1){
    stop();
    if (p <= 0 && audio.duration) { try { audio.currentTime = 0; } catch (e) {} }
    return;
  }
  if (errs >= 3) return;            // the file genuinely will not load

  const dur = audio.duration;
  if (dur){
    const target = dur * p;
    if (Math.abs(audio.currentTime - target) > DRIFT){
      try { audio.currentTime = target; } catch (e) { /* not seekable yet */ }
    }
  }

  if (audio.paused){
    /* Try every time rather than trusting our own arming flag. If the visitor
       clicked anything at all earlier, the document already carries activation
       and this simply works; if not, it is refused and we stay quiet. The
       browser is the authority on that, not us. */
    const play = audio.play();
    if (play && play.catch) play.catch(() => {
      if (!armed && !told2){ told2 = true;
        console.info('[hero-audio] blocked until you click the page once — ' +
                     'browsers never allow sound from scrolling alone.'); }
    });
  }
  ramp(VOLUME);

  /* Sound only while the page is actually moving. This is what makes it read as
     scrubbing rather than as a track playing underneath the page. */
  clearTimeout(idle);
  idle = setTimeout(stop, IDLE_MS);
}

addEventListener('scroll', () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => { ticking = false; sync(); });
}, { passive:true });

/* coming back to a tab mid-swell is unpleasant */
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });

})();
