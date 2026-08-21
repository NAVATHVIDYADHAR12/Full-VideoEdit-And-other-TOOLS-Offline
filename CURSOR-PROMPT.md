# CURSOR-PROMPT.md — build this cursor, exactly

**Read this whole file before writing anything.**

You are building a custom mouse cursor for a website. It has two parts:

1. **A glass bubble** that follows the pointer while it travels across open
   areas of the page — body text, backgrounds, the hero.
2. **A wave** — expanding ripples the bubble leaves behind as it moves. On the
   landing page only.

Over anything the visitor *points at* — a button, a link, an image, a bordered
card — the bubble disappears and the **ordinary arrow** comes back.

This file contains the complete, working source. Copy it exactly. Do not
"improve" it, do not rename the classes, and do not reorder the CSS rules —
several of them depend on being where they are.

---

## Part 1 — The behaviour you are producing

| Where the pointer is | What the visitor sees |
|---|---|
| Body copy, headings, paragraphs, lists | glass bubble + wave |
| Section backgrounds, empty space | glass bubble + wave |
| The hero | glass bubble + wave |
| A scrolling decorative band | glass bubble + wave |
| Any button or link | normal arrow |
| The logo, nav links, dropdown entries | normal arrow |
| Any image | normal arrow |
| A card with a border or panel background | normal arrow |
| A text input | normal I-beam |
| A draggable clip in an editor | `grab` / `grabbing` |
| A resize handle | `ew-resize` |
| A drawing surface | `crosshair` |
| A disabled button | `not-allowed` |
| **Any phone or tablet** | **nothing at all — normal cursor, no code runs** |

Bubble details:

- 26px across, follows with a slight lag (it does **not** stick to the pointer).
- **Stretches along its direction of travel.** This is what makes it read as
  liquid instead of as a circle that lags. Do not skip it.
- Wobbles its border-radius very slightly on a 5.2s loop.
- A highlight glint drifts across it on the same loop.
- A 3px dot sits at the **exact** pointer position with zero lag, so precision
  is never lost.
- Brightens over clickable things. **It does not grow.**
- Pinches to 80% while the mouse button is held.

Wave details:

- A ring is dropped every 24px of travel and expands to about 165px over one
  second while fading.
- Two circles per ring — gold at full radius, pale white at 82% — drawn in
  `lighter` blend mode so crests glow where they overlap.
- Never more than 64 rings alive.
- Only on the landing page, and only while the landing page is showing.

---

## Part 2 — The one rule that everything depends on

**`cursor` is an inherited CSS property.**

If you take nothing else from this file, take this. The obvious way to hide the
cursor is:

```css
/* WRONG. Do not do this. */
.gcur-on * { cursor: none; }
```

That sets `none` **directly on every element**, including the `<span>` inside a
button and the `<img>` and text inside a logo link. So you set the arrow on the
button, and the browser still shows nothing over the text you actually hover.
The button looks broken. This exact mistake took three rounds of "the arrow
still is not showing" to find.

The correct way is a single declaration on the root:

```css
/* RIGHT. */
.gcur-on { cursor: none; }
```

Now anything that declares its own cursor **passes it down to its children for
free**, and anything that declares nothing inherits `none` and gets the bubble.
One line, and the whole class of bug disappears.

**Consequence you must respect:** to give a card the arrow, you style *the card*.
Never its children. They inherit.

---

## Part 3 — Deciding arrow vs bubble

The test is **not** "is this text?" It is:

> **Is this thing visibly bounded — does it have a border or a panel background?**

- A tool card has a panel background, so it is a box. Its descriptive text takes
  the arrow along with the rest of it.
- A feature row is copy beside a picture with no box drawn around it. Its
  heading, paragraph and list all keep the **bubble**. Only the picture beside
  them is a box.

Two components in the original looked like cards and were not — they had padding
and at most a top rule, no border or background. Both were given the arrow and
both were wrong. **Check the actual CSS for a `border` or `background` before you
decide.**

---

## Part 4 — Create `css/cursor.css`

Or append this to your existing stylesheet. If you append it, it must come
**after** any stylesheet that sets `cursor: pointer`, because some of these rules
win on source order.

Replace the class names in the "clickable" and "boxes" lists with the ones your
own site uses. Keep everything else exactly as written.

```css
/* WHERE THE REAL CURSOR SURVIVES
   This is one declaration on the root rather than a universal selector, and the
   difference matters: cursor is an inherited property, so `.gcur-on *` was
   forcing none onto the spans inside a button and the two spans inside the
   logo -- which is why no arrow showed on their text. With inheritance instead,
   anything that declares a cursor passes it down to its children for free, and
   anything that declares none of its own quietly inherits none and gets the
   bubble. cursor.js reads the computed value on hover and withdraws the bubble
   wherever a real cursor survives, so the two are never on screen together. */
.gcur-on{ cursor:none; }

/* The bubble is for travelling across the page, not for pointing at things.
   Anything clickable, and every image, hands the ordinary arrow back -- on all
   pages. Children need no rules of their own; they inherit these. */
.gcur-on a,
.gcur-on button,
.gcur-on summary,
.gcur-on label,
.gcur-on select,
.gcur-on img,
.gcur-on [role="button"],
.gcur-on [data-go],
.gcur-on [data-scroll],
.gcur-on .toolcard,
.gcur-on .tool,
.gcur-on .drop,
.gcur-on .toggle,
.gcur-on .chip,
.gcur-on .cdot,
.gcur-on .pstar,
.gcur-on .atab,
.gcur-on .cnav,
.gcur-on .lbnav,
.gcur-on .authclose,
.gcur-on .chatclose{ cursor:default; }

/* Boxes take the arrow across their whole face, clickable or not. The test is
   whether the thing is visibly bounded -- it has a border or a panel background,
   so it reads as an object you point at. Children inherit, so naming the
   container is enough.

   Prose does NOT qualify, and that is the important half of this rule. A
   capability row is copy beside a picture with no box around it, so its heading,
   paragraph and facts all keep the bubble and ripple as you read across them.
   Only the picture beside them is a box. Same for the treadmill band and every
   section heading: descriptive text is travelled over, not pointed at. */
.gcur-on .shot,
.gcur-on .fbcell,
.gcur-on .plan,
.gcur-on .pnotice,
.gcur-on .soonmark{ cursor:default; }

/* Two rules in this sheet out-specify a bare tag selector, so they are named in
   full rather than left to win by accident. */
.gcur-on .navmenu .mitem{ cursor:default; }
.gcur-on .shot.carousel .cslide,
.gcur-on .shot.carousel .cslide.prev,
.gcur-on .shot.carousel .cslide.next,
.gcur-on .shot.carousel .cslide.active{ cursor:default; }

/* Kept: shapes that carry information the arrow cannot. */
.gcur-on input, .gcur-on textarea, .gcur-on [contenteditable]{ cursor:auto; }
.gcur-on input[type="range"]{ cursor:pointer; }
.gcur-on button:disabled{ cursor:not-allowed; }
.gcur-on .poolitem{ cursor:grab; }
.gcur-on .poolitem:active{ cursor:grabbing; }
.gcur-on .clip{ cursor:grab; }
.gcur-on .clip:active{ cursor:grabbing; }
.gcur-on .clip .grip{ cursor:ew-resize; }
.gcur-on .wmstage canvas{ cursor:crosshair; }
.gcur-on .lightbox{ cursor:zoom-out; }   /* says that a click dismisses it */
.gcur-on video[controls]{ cursor:auto; }

/* the wrapper carries no size: it is just the point the ball hangs from */
.gcur{
  position:fixed; top:0; left:0; width:0; height:0;
  pointer-events:none; z-index:9000;
  opacity:0; transition:opacity .32s ease;
  will-change:transform;
}
.gcur.in{ opacity:1; }
.gcur.off{ opacity:0; }

/* the ball */
.gcur-rim{
  position:absolute; left:-13px; top:-13px; width:26px; height:26px;
  border-radius:50%;
  border:1px solid rgba(255,255,255,.22);
  background:
    radial-gradient(58% 58% at 34% 30%, rgba(255,255,255,.20), rgba(255,255,255,.04) 52%, transparent 72%),
    radial-gradient(100% 100% at 50% 55%, rgba(198,161,91,.13), rgba(198,161,91,.03) 60%, transparent 78%);
  backdrop-filter:blur(1.8px) saturate(165%) brightness(1.06);
  -webkit-backdrop-filter:blur(1.8px) saturate(165%) brightness(1.06);
  box-shadow:
    inset 0 1px 6px rgba(255,255,255,.16),
    inset 0 -4px 9px rgba(198,161,91,.10),
    0 3px 12px rgba(0,0,0,.30);
  transition:transform .34s cubic-bezier(.22,.61,.36,1),
             border-color .34s ease, box-shadow .34s ease;
  animation:gcur-breathe 5.2s ease-in-out infinite;
}

/* the specular glint, drifting slowly so the ball never looks like a decal */
.gcur-sheen{
  position:absolute; left:-13px; top:-13px; width:26px; height:26px;
  border-radius:50%; overflow:hidden; opacity:.85;
  transition:transform .34s cubic-bezier(.22,.61,.36,1), opacity .34s ease;
}
.gcur-sheen::before{
  content:''; position:absolute; left:19%; top:14%; width:38%; height:28%;
  border-radius:50%;
  background:linear-gradient(140deg, rgba(255,255,255,.62), rgba(255,255,255,.05));
  filter:blur(1.5px);
  animation:gcur-glint 5.2s ease-in-out infinite;
}

/* Over something clickable the ball keeps its size and only brightens -- it
   used to swell, which read as heavy at this diameter. */
.gcur.hot .gcur-rim{
  border-color:rgba(227,201,130,.46);
  box-shadow:
    inset 0 1px 8px rgba(255,255,255,.22),
    inset 0 -5px 11px rgba(198,161,91,.17),
    0 4px 15px rgba(0,0,0,.32);
}

/* and pinches on press */
.gcur.press .gcur-rim,
.gcur.press .gcur-sheen{ transform:scale(.8); }

/* the exact point, with no lag, so precision never suffers */
.gcur-dot{
  position:fixed; top:0; left:0; width:3px; height:3px; margin:-1.5px 0 0 -1.5px;
  border-radius:50%; background:var(--accent2);
  pointer-events:none; z-index:9001;
  opacity:0; transition:opacity .32s ease;
  will-change:transform;
}
.gcur-dot.in{ opacity:.85; }
.gcur-dot.off{ opacity:0; }

/* the wave it leaves behind -- landing page only, injected nowhere else */
.gcur-wave{
  position:fixed; inset:0; width:100%; height:100%;
  pointer-events:none; z-index:8999;
}

@keyframes gcur-breathe{
  0%,100%{ border-radius:50% 50% 50% 50%; }
  33%    { border-radius:53% 47% 49% 51%; }
  66%    { border-radius:47% 52% 51% 48%; }
}
@keyframes gcur-glint{
  0%,100%{ transform:translate(0,0) rotate(0deg); opacity:.85; }
  50%    { transform:translate(11%,7%) rotate(16deg); opacity:.62; }
}

/* the script never injects any of this on a touch screen or under reduced
   motion, but belt and braces in case the markup is ever hand-placed */
@media (hover:none), (pointer:coarse), (prefers-reduced-motion:reduce){
  .gcur, .gcur-dot, .gcur-wave{ display:none !important; }
  .gcur-on, .gcur-on *{ cursor:auto; }
}
```

---

## Part 5 — Create `js/cursor.js`

Copy this file exactly. It has no dependencies and no build step.

```js
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
```

---

## Part 6 — Wire it up

Add this as the **last** script tag, immediately before `</body>`, on every page
that should have the cursor:

```html
<script src="js/cursor.js"></script>
```

The wave adds itself only where an element with `id="hero"` exists. If your
landing page has no such element, either add one or change the `WAVES` line in
`cursor.js` to test for whatever identifies your landing page.

**If a tool or app view can hide your landing page**, give that container
`id="landing"` and add a `hide` class to it when it is hidden. The script reads
this to switch the wave off, because ripples across a working surface are noise.

---

## Part 7 — Numbers you may tune

| Constant | Value | What it does |
|---|---|---|
| `VOLUME`-style ball size | `26px` | in the CSS, `.gcur-rim` width/height. Also update `left`/`top` to minus half. |
| `EASE` | `0.19` | how hard the ball chases the pointer. Lower = more lag. |
| `STEP` | `24` | pixels of travel between ripples. Lower = denser trail. |
| `MAX_RINGS` | `64` | ripple cap. Raise only if you have measured the cost. |
| stretch divisor | `130` | in `frame()`. Lower = more dramatic squash. |
| stretch cap | `0.34` | maximum squash. Above ~0.5 it looks rubbery. |
| ring growth | `1.9 + force*0.8` | pixels per frame. |
| ring fade | `0.017` | life lost per frame. ~1 second at 60fps. |

---

## Part 8 — How to verify it, properly

**Do not verify by looking at it.** You will miss exactly the cases that matter.

Write a throwaway script that:

1. Reads every stylesheet **in load order**.
2. **Strips `@media` blocks.** If you skip this, the reduced-motion fallback
   matches everything and every result is wrong.
3. Computes CSS specificity properly — `(ids, classes+attributes+pseudos, tags)`.
4. Models inheritance: if no rule matches an element, walk up its ancestors and
   take the first cursor found.
5. Resolves the winning `cursor` for a list of real element chains.

Then assert **the direction** for each case, rather than printing values and
eyeballing them:

- Prose chains must resolve to `none`: a section heading, a paragraph, a list
  item, **and the `<b>` inside that list item**.
- Control chains must resolve to `default`: a button, **the `<span>` inside that
  button**, a link, an image, a bordered card, **and the text inside that card**.
- Affordance chains must be untouched: `grab`, `ew-resize`, `crosshair`, the
  I-beam, `not-allowed`.

The inner-text cases are the whole point. A test that only checks containers
will pass while the site is visibly broken.

---

## Part 9 — Mistakes that were actually made building this

**M1 — The universal selector.** Part 2. Cost more than everything else combined.

**M2 — A class name that already meant something.** A new `.chip` rule silently
restyled every file chip in the app, because the new stylesheet loaded second.
Grep for a class name before you invent it.

**M3 — Giving the arrow to an unbounded row.** Part 3.

**M4 — Blanket `img { cursor: default }` without checking the hero.** If the hero
renders frames into an `<img>`, that one rule kills the wave across the entire
hero. Check what the hero actually is. In this build it is a `<canvas>`, which is
why the rule is safe.

**M5 — Verifying with a parser that ignored `@media`.** Every result came back
as the reduced-motion fallback value, and all of it looked plausible.

**M6 — Trusting `node --check`.** It proves syntax, not that variables exist.
Deleting a variable and leaving references behind passes the check, then throws
`ReferenceError` on every event. Grep for the old name and run the code path.

---

## Part 10 — Acceptance checklist

Not done until every line passes.

- [ ] `.gcur-on *` appears **nowhere** in your CSS except inside the
      reduced-motion media query at the bottom.
- [ ] Hovering the **text inside** a button shows the arrow, not the bubble.
- [ ] Hovering the **text inside** a logo link shows the arrow.
- [ ] Hovering a paragraph shows the bubble and leaves ripples.
- [ ] Hovering the `<b>` inside a list item shows the bubble.
- [ ] Hovering a bordered card, and its inner text, shows the arrow.
- [ ] Two cursors are never visible at once, anywhere.
- [ ] A fast mouse flick leaves an even trail, not one lonely ring.
- [ ] Editor affordances survive: `grab`, `ew-resize`, `crosshair`, I-beam,
      `not-allowed`.
- [ ] On a phone or tablet nothing is injected and the normal cursor works.
- [ ] With `prefers-reduced-motion: reduce`, nothing is injected.
- [ ] Unplugging the mouse mid-session tears the cursor down.
- [ ] Leaving the page idle stops the animation loop entirely.
- [ ] The wave does not run on secondary pages.
