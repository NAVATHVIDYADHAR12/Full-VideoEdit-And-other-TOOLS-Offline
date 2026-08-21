/* hero-audio.js — a riser scrubbed by the hero, in step with the frames.
 *
 * The clip is 13.5s and the hero is 340vh of scroll, so the mapping is simply
 * currentTime = progress * duration. It lands on the last note exactly as the
 * last frame draws, whatever the window height, because both read the same
 * progress figure that landing.js uses for the frames.
 *
 * OFF BY DEFAULT, AND THAT IS DELIBERATE. Two reasons, either one sufficient:
 * every browser blocks audio that starts without a real user gesture, so an
 * autoplaying version would simply be silent for most people; and sound nobody
 * asked for is hostile. A small control sits in the corner of the hero and does
 * nothing at all until it is pressed.
 *
 * SELF-CONTAINED BY DESIGN. This file creates its own audio element, its own
 * button and its own listeners. To remove the feature entirely, delete the one
 * script tag in index.html, this file, assets/hero-riser.mp3, and the .heroaud
 * block in css/landing.css. Nothing else references any of it.
 */
(function () {
'use strict';

const hero = document.getElementById('hero');
const stage = document.querySelector('.herostage');
if (!hero || !stage) return;                 // landing page only

const SRC      = 'assets/hero-riser.mp3';
const VOLUME   = 0.55;    // the ceiling; a riser at full scale is startling
const DRIFT    = 0.35;    // seconds out of step before it is worth re-seeking
const IDLE_MS  = 170;     // silence this long after scrolling stops
const FADE_MS  = 120;     // enough to kill the click at each edge

/* ================= the element ================= */
const audio = new Audio();
audio.src = SRC;
audio.preload = 'none';   // nothing is fetched until someone asks for sound
audio.volume = 0;
audio.setAttribute('aria-hidden', 'true');

/* ================= the control ================= */
const SPK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
            'stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M11 5 6 9H2v6h4l5 4z"/>';
const ON  = SPK + '<path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
const OFF = SPK + '<path d="M17 9.5l4 5M21 9.5l-4 5"/></svg>';

const btn = document.createElement('button');
btn.type = 'button';
btn.className = 'heroaud';
btn.innerHTML = OFF + '<span>Sound</span>';
btn.setAttribute('aria-pressed', 'false');
btn.setAttribute('aria-label', 'Play the hero soundtrack while scrolling');
stage.appendChild(btn);

/* ================= state ================= */
let on = false, idle = 0, fade = 0, ready = false;

btn.addEventListener('click', () => {
  on = !on;
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.innerHTML = (on ? ON : OFF) + '<span>Sound</span>';

  if (!on){ stop(); return; }

  /* The click is the user gesture the autoplay policy wants, so load and prime
     here rather than at startup. Priming muted then seeking means the first
     scroll makes a sound instead of waiting on a buffer. */
  audio.preload = 'auto';
  audio.load();
  sync(true);
});

/* ================= progress, read exactly as the frames read it ================= */
function progress(){
  const rect  = hero.getBoundingClientRect();
  const total = rect.height - window.innerHeight;
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
  ramp(0, () => audio.pause());
}

function sync(force){
  if (!on) return;
  const p = progress();

  // Above the hero, or done with it: hold silence and rewind for the next pass.
  if (p <= 0 || p >= 1){
    stop();
    if (p <= 0 && audio.duration) audio.currentTime = 0;
    return;
  }

  const target = (audio.duration || 0) * p;
  if (audio.duration && (force || Math.abs(audio.currentTime - target) > DRIFT)){
    try { audio.currentTime = target; } catch (e) { /* not seekable yet */ }
  }

  if (audio.paused){
    const play = audio.play();
    if (play && play.catch) play.catch(() => {
      /* Blocked anyway, or the file will not decode. Fail quietly and put the
         control back rather than leaving a button that lies. */
      on = false;
      btn.classList.remove('on');
      btn.setAttribute('aria-pressed', 'false');
      btn.innerHTML = OFF + '<span>Sound</span>';
    });
  }
  ramp(VOLUME);

  /* Sound continues only while the page is actually moving, which is what makes
     it read as scrubbing rather than as a track playing underneath. */
  clearTimeout(idle);
  idle = setTimeout(stop, IDLE_MS);
}

audio.addEventListener('loadedmetadata', () => { ready = true; });
audio.addEventListener('error', () => {
  on = false;
  btn.remove();
});

let ticking = false;
addEventListener('scroll', () => {
  if (!on || ticking) return;
  ticking = true;
  requestAnimationFrame(() => { ticking = false; sync(false); });
}, { passive:true });

/* Leaving the tab with a riser mid-swell is unpleasant to come back to. */
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });

})();
