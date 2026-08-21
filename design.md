# design.md — the complete design template

**What this file is.** A build prompt. Hand it to any AI, or any person, and they
should be able to reproduce this site's design from nothing: the palette, the
type, the motion, the floating nav, the cards, the glass cursor, the scroll
reveals — all of it, with the exact numbers.

**How to use it.** Read Part 0 first; it contains the rules that must not be
broken. Then build in the order given in Part 11. Do not skim Part 12 — every
pitfall in it is one that was actually hit while building this, and each cost
real time.

**The one instruction that matters most.** Every value in this document is the
value that is actually in the stylesheet. When something here disagrees with what
you think looks right, the file wins. Change it deliberately or not at all.

---

## Part 0 — Non-negotiables

These are not style preferences. Breaking one of these is a defect.

**0.1 Nothing may claim to work when it does not.** This site is static. There is
no server, no database, no session. So:

- The sign-up and log-in forms are **a design, not an account system**. Fields
  are `disabled`. A notice sits above them saying so in plain words. There is a
  single flag, `ACCOUNTS_LIVE = false`, and two functions that throw. Wiring them
  to `localStorage` would look like it worked while protecting nothing, and would
  invite someone to type a password they use elsewhere. **Never store a password
  anywhere, in any form, including browser storage.**
- Ratings are **not fabricated**. The breakdown is all zeros with an honest empty
  state. Do not seed it with plausible-looking numbers.
- Payments are not live, and the pricing page says so.

**0.2 The work happens on the user's machine.** Every tool processes files
locally. Nothing is uploaded. This is the product's whole argument, so the design
states it repeatedly and literally — in the hero, in the section copy, in the
footer.

**0.3 Accessibility is not optional.**

- Everything respects `prefers-reduced-motion: reduce`. Reveals resolve
  instantly, the cursor is never injected, the hero shows a still frame.
- Every decorative element carries `aria-hidden="true"`.
- Nothing conveys meaning by colour alone.

**0.4 Restraint is the aesthetic.** Gold is an accent, not a colour scheme.
Burgundy appears perhaps twice on the whole site. If a page has more than one
element competing for attention, it is wrong.

---

## Part 1 — Tokens

Declare these once on `:root` and never hard-code a colour anywhere else. A hex
value outside this block is a bug, with two documented exceptions: alpha overlays
derived from a token, and four burgundy and status shades that have no token of
their own (`#4d1a22`, `#E7C7B6`, `#D9938B`, `#F4D9C8`). Do not add a fifth.

```css
:root{
  --bg:#080808;          /* obsidian black         */
  --panel:#11100F;       /* royal charcoal         */
  --panel2:#151311;      /* dark espresso          */
  --line:#292621;        /* obsidian gray, borders */
  --text:#F4EFE6;        /* warm ivory             */
  --dim:#B8B0A3;         /* muted champagne        */
  --accent:#C6A15B;      /* antique champagne gold */
  --accent2:#E3C982;     /* pale gold              */
  --burgundy:#3A1118;    /* used sparingly, by design */
  --ok:#A8B79A;
  --warn:#C6A15B;
  --err:#C77B72;
  --serif:'Instrument Serif',Georgia,'Times New Roman',serif;
  --sans:'Manrope',ui-sans-serif,system-ui,'Segoe UI',Roboto,sans-serif;
}
```

**Alpha overlays.** When you need a tint, derive it from a token rather than
inventing a new colour: `rgba(198,161,91,α)` is `--accent`; `rgba(227,201,130,α)`
is `--accent2`; `rgba(17,16,15,α)` is `--panel`. Typical α values in use: `.07`
for a whisper, `.11`–`.16` for a fill, `.30`–`.55` for a border.

**Fonts are self-hosted.** Do not link Google Fonts. Three files, ~76 KB total,
in `assets/fonts/`:

```css
@font-face{font-family:'Instrument Serif';font-weight:400;font-style:normal;font-display:swap;
  src:url('../assets/fonts/instrument-serif-normal-400.woff2') format('woff2')}
@font-face{font-family:'Instrument Serif';font-weight:400;font-style:italic;font-display:swap;
  src:url('../assets/fonts/instrument-serif-italic-400.woff2') format('woff2')}
@font-face{font-family:'Manrope';font-weight:300 800;font-style:normal;font-display:swap;
  src:url('../assets/fonts/manrope-normal-300_800.woff2') format('woff2')}
```

Manrope is a variable font — one file covers 300 to 800. `font-display:swap` so
text is readable before the face lands.

---

## Part 2 — Typography

**The rule: serif for statements, sans for everything else.** Instrument Serif
appears only in headings and in the logo. Every other character on the site is
Manrope. There is no third voice.

| Role | Family | Size | Weight | Tracking | Notes |
|---|---|---|---|---|---|
| Hero display | serif | `clamp(2.6rem, 6.4vw, 5.4rem)` | 400 | `-.02em` | `line-height:1.02` |
| Section h2 | serif | `clamp(2rem, 3.9vw, 3.3rem)` | 400 | `-.015em` | `line-height:1.08` |
| Card h3 | serif | `clamp(1.5rem, 2.4vw, 2.1rem)` | 400 | `-.01em` | |
| Eyebrow | sans | `11px` | 600 | `.2em` | uppercase, `--accent` |
| Body / lede | sans | `15–19px` | 400 | normal | `--dim`, `line-height:1.7` |
| Button label | sans | `13px` | 600–700 | `.06em` | uppercase |
| Badge | sans | `10px` | 400 | `.18em` | uppercase, `--dim` |
| Micro-label | sans | `9.5px` | 600 | `.13em` | uppercase |

**Never bold a serif heading.** Instrument Serif ships at 400 only; asking for
700 gets you a synthesised smear. Emphasis inside a heading is done with
`<em>`, which renders as the true italic:

```html
<h2>Built for the work, <em>not the demo</em>.</h2>
```

```css
.sechead h2 em{ font-style:italic; color:var(--accent); }
```

**Headings are sentences.** They end in a full stop. "A real timeline, not a
trimmer." — not "A Real Timeline". Sentence case throughout; title case appears
nowhere.

---

## Part 3 — Layout and spacing

```css
.shell  { width:min(1180px, calc(100% - 48px)); margin:0 auto; }
.section{ padding:clamp(90px, 13vh, 160px) 0; position:relative; }
.section + .section{ border-top:1px solid var(--line); }
.sechead{ max-width:760px; margin-bottom:clamp(52px, 7vh, 88px); }
```

- **One container width**, 1180px. Everything aligns to it.
- **Sections are separated by a single hairline**, never by a colour change.
- **Measure is capped at 760px** for reading copy. Long lines look cheap.
- **Vertical rhythm is viewport-relative** via `clamp()`, so a laptop and a large
  monitor both feel considered rather than one feeling empty.

**Radius discipline.** Marketing surfaces use `border-radius:2px` — nearly square,
which reads as precise. The tool UI inside the app uses 7–10px, which reads as
soft and usable. Do not mix the two vocabularies on one surface.

---

## Part 4 — Motion

**One curve.** `cubic-bezier(.22,.61,.36,1)` is used in roughly thirty places and
is the house easing. It decelerates hard, which reads as heavy and expensive. Do
not introduce a second curve without a reason you can articulate. (Two
exceptions exist: `cubic-bezier(.5,0,.5,1)` for a symmetric loop, and
`cubic-bezier(.34,1.4,.64,1)` for the one element that overshoots.)

**Durations.** Hover feedback `.25–.35s`. Entrances `.45–.7s`. Layout and
backdrop changes `.5s`. One deliberate outlier: the picture side of a capability
card runs `.95s` so it always settles after the words. Past a second, motion
stops reading as considered and starts reading as broken.

**What may animate.** `opacity`, `transform`, `filter`, `border-color`,
`box-shadow`, `backdrop-filter`. Never animate `width`, `height`, `top`, `left`
or `margin` — they force layout every frame.

---

## Part 5 — The floating nav

The signature element. A capsule that hovers over the page, gains a frosted
backing once you scroll, and retreats when you scroll down.

```css
.nav{
  position:fixed; top:18px; left:50%; transform:translateX(-50%);
  z-index:200; width:min(1180px, calc(100% - 40px));
  display:flex; align-items:center; gap:26px;
  padding:13px 4px 13px 22px;
  border:1px solid transparent; border-radius:2px;
  background:transparent;
  transition:background .5s ease, border-color .5s ease,
             padding .5s ease, backdrop-filter .5s ease;
  will-change:transform;
}
.nav.stuck{
  background:rgba(17,16,15,.82);
  backdrop-filter:blur(18px) saturate(140%);
  -webkit-backdrop-filter:blur(18px) saturate(140%);
  border-color:var(--line);
  padding:10px 4px 10px 20px;
}
.nav.hidden{ transform:translateX(-50%) translateY(-170%); }
```

**Behaviour.**

1. At the top of the page the bar is invisible — transparent, no border.
2. Past roughly 40px it gains `.stuck`: frosted panel, hairline border, and it
   tightens by 3px vertically. The tightening is what sells it.
3. Scrolling **down** adds `.hidden` and it leaves. Scrolling **up** brings it
   straight back. Always re-show near the top.
4. When a tool panel is open the bar stays `.stuck` permanently — there is no
   hero behind it to be transparent against.

**Layout inside the bar.** Left to right: brand, then `margin-left:auto` on the
link group pushes everything else right. Note the asymmetric padding —
`22px` on the left, `4px` on the right. The right side is deliberately tight so
the menu button reaches the corner instead of stopping short of it.

```css
.navlinks{ display:flex; gap:30px; margin-left:auto; }
.brand + .navcta{ margin-left:auto; }   /* pages with no link group */
```

That second rule matters: `tools.html` and `pricing.html` have no `.navlinks`, so
without it the call to action would sit against the logo.

**The underline sweep.** Nav links get a rule that grows from the left on hover:

```css
.navlinks a::after{
  content:''; position:absolute; left:0; right:100%; bottom:-6px; height:1px;
  background:var(--accent); transition:right .4s cubic-bezier(.22,.61,.36,1);
}
.navlinks a:hover::after{ right:0; }
```

**The dropdown.** "The Ten Tools" opens a two-column panel on hover *and* on
focus — `:focus-within`, so it is keyboard reachable.

- Panel sits `calc(100% + 16px)` below, centred with `translateX(-50%)`.
- Entries stagger in pairs: rows at `.04s`, `.08s`, `.12s`, `.16s`, `.20s`, so
  the eye reads **down** the columns, not across.
- A `::before` pseudo-element bridges the 16px gap above the panel, otherwise
  moving the pointer toward it dismisses it.
- Suppress the nav underline inside the panel: `.navlinks .dropmenu a::after{ display:none }`.
- Each entry carries **both** a real `href` and a `data-go` slug, so middle-click
  and ctrl-click still work while the router handles a plain click.

**In-page links must survive a hidden landing page.** When a tool panel is open,
the landing container carries `.hide` (`display:none`), so its sections have no
box and `scrollIntoView` silently does nothing. Any `data-scroll` link must
detect this, return home first, and only then scroll:

```js
const buried = landing && landing.classList.contains('hide');
if (!buried){ target.scrollIntoView({behavior:'smooth', block:'start'}); return; }

/* Clear the hash to send the router back to the landing page, then scroll once
   it has actually swapped the view in. Waiting on hashchange rather than a timer
   means there is no guessed delay to get wrong. */
const afterSwap = () => {
  window.removeEventListener('hashchange', afterSwap);
  requestAnimationFrame(() => target.scrollIntoView({behavior:'smooth', block:'start'}));
};
window.addEventListener('hashchange', afterSwap);
location.hash = '';
```

The router's own `hashchange` listener is registered at load, so it runs first —
un-hiding the page and doing its `scrollTo(0,0)` — and the `requestAnimationFrame`
lands the section scroll on top of it. Order is guaranteed by registration order,
not by luck.

---

## Part 6 — The glass cursor

A small liquid-glass bubble follows the pointer while you travel across the page.
Over anything you can point *at* — a button, a link, a card, an image — the
ordinary arrow comes back instead. On the landing page the bubble leaves an
expanding wave behind it.

### 6.1 The rule that makes it work

**`cursor` is an inherited property.** This single fact determines the whole
design, and getting it wrong is the bug that took three rounds to find.

Do **not** write `.gcur-on *{ cursor:none }`. A universal selector sets `none`
directly on every element, including the `<span>` inside a button and the two
children of the logo anchor — so the arrow is set on the button but never on the
text you actually hover. The button looks broken.

Write one declaration on the root instead:

```css
.gcur-on{ cursor:none; }
```

Now every element with no cursor of its own inherits `none` and gets the bubble,
while anything that declares a cursor passes it down to its children for free.
One line, and the entire class of bug disappears.

### 6.2 Where the arrow comes back

```css
/* Anything clickable, plus every image. Children inherit — no rules needed. */
.gcur-on a, .gcur-on button, .gcur-on summary, .gcur-on label,
.gcur-on select, .gcur-on img,
.gcur-on [role="button"], .gcur-on [data-go], .gcur-on [data-scroll],
.gcur-on .toolcard, .gcur-on .tool, .gcur-on .drop, .gcur-on .toggle,
.gcur-on .chip, .gcur-on .cdot, .gcur-on .pstar, .gcur-on .atab,
.gcur-on .cnav, .gcur-on .lbnav, .gcur-on .authclose,
.gcur-on .chatclose{ cursor:default; }

/* Boxes take the arrow whether clickable or not. The test is whether the thing
   is visibly bounded -- a border or a panel background -- so it reads as an
   object you point at rather than prose you read across. */
.gcur-on .shot, .gcur-on .fbcell, .gcur-on .plan,
.gcur-on .pnotice, .gcur-on .soonmark{ cursor:default; }

/* Two rules in this sheet out-specify a bare tag selector, so name them in full
   rather than letting them win by accident. */
.gcur-on .navmenu .mitem{ cursor:default; }
.gcur-on .shot.carousel .cslide,
.gcur-on .shot.carousel .cslide.prev,
.gcur-on .shot.carousel .cslide.next,
.gcur-on .shot.carousel .cslide.active{ cursor:default; }

/* Kept: shapes that carry information an arrow cannot. */
.gcur-on input, .gcur-on textarea, .gcur-on [contenteditable]{ cursor:auto; }
.gcur-on input[type="range"]{ cursor:pointer; }
.gcur-on button:disabled{ cursor:not-allowed; }
.gcur-on .poolitem, .gcur-on .clip{ cursor:grab; }
.gcur-on .poolitem:active, .gcur-on .clip:active{ cursor:grabbing; }
.gcur-on .clip .grip{ cursor:ew-resize; }
.gcur-on .wmstage canvas{ cursor:crosshair; }
.gcur-on .lightbox{ cursor:zoom-out; }
.gcur-on video[controls]{ cursor:auto; }
```

**What still gets the bubble:** all descriptive text, section backgrounds, the
hero, the treadmill band — everything you travel across rather than point at.

**The prose test is the hard part, and it is easy to get backwards.** A
capability row is copy beside a picture with no box drawn around it, so its
heading, paragraph and facts list must all ripple; only the picture beside them
is a box. A tool card, by contrast, has a panel background, so its descriptive
`<small>` takes the arrow along with the rest of the card. The deciding question
is never "is this text?" but "is this text inside something visibly bounded?"

Two components exist that look like cards and are not: `.feature` and `.soonrow`
have padding and, at most, a top rule — no border, no background. Both were
briefly given the arrow and both were wrong.

**Verify by resolving the cascade, not by eye.** Write a throwaway script that
parses both stylesheets in load order, computes specificity properly, and reports
the winning `cursor` for a list of real element chains — the card *and its inner
heading*, the button *and its inner span*. Two things to get right in that
script: strip `@media` blocks (the reduced-motion fallback will otherwise poison
every result), and model inheritance by walking up the chain when nothing
matches.

### 6.3 The bubble itself

Structure — a zero-size wrapper that JS transforms, with the visuals as children,
so hover and press scaling never fight the follow transform:

```html
<div class="gcur" aria-hidden="true"><i class="gcur-sheen"></i><i class="gcur-rim"></i></div>
<div class="gcur-dot" aria-hidden="true"></div>
```

```css
.gcur{ position:fixed; top:0; left:0; width:0; height:0;
       pointer-events:none; z-index:9000; opacity:0;
       transition:opacity .32s ease; will-change:transform; }
.gcur.in{ opacity:1; }
.gcur.off{ opacity:0; }          /* a real cursor is showing here */

.gcur-rim{
  position:absolute; left:-13px; top:-13px; width:26px; height:26px;
  border-radius:50%; border:1px solid rgba(255,255,255,.22);
  background:
    radial-gradient(58% 58% at 34% 30%, rgba(255,255,255,.20), rgba(255,255,255,.04) 52%, transparent 72%),
    radial-gradient(100% 100% at 50% 55%, rgba(198,161,91,.13), rgba(198,161,91,.03) 60%, transparent 78%);
  backdrop-filter:blur(1.8px) saturate(165%) brightness(1.06);
  box-shadow: inset 0 1px 6px rgba(255,255,255,.16),
              inset 0 -4px 9px rgba(198,161,91,.10),
              0 3px 12px rgba(0,0,0,.30);
  animation:gcur-breathe 5.2s ease-in-out infinite;
}
```

Four details do the work:

1. **`backdrop-filter`** — it genuinely refracts what is underneath. Without it
   the ball is a sticker.
2. **The breathe keyframe** wobbles `border-radius` between `50%` and
   `53% 47% 49% 51%`. Barely visible, and it is what makes it read as liquid
   rather than as a circle.
3. **The drifting glint** — a small blurred highlight at 19%/14% that translates
   and rotates slightly on the same 5.2s cycle.
4. **The 3px dot** rides the exact pointer position with *no* lag, while the ball
   trails behind. Precision never suffers for the effect.

**Follow and squash**, per frame:

```js
bx += (tx - bx) * 0.19;                     // chase
const stretch = Math.min(speed / 130, 0.34); // liquid, not rubbery
const ang     = Math.atan2(by - ty, bx - tx) * 180 / Math.PI;
bubble.style.transform =
  `translate3d(${bx}px,${by}px,0) rotate(${ang}deg) scale(${1+stretch},${1-stretch*0.62})`;
```

Stretching along the direction of travel is what sells it. Without it you have a
circle that lags.

**Hover does not resize it.** At 26px a swell reads as heavy. The rim brightens
and that is all. Press pinches to `scale(.8)`.

### 6.4 Standing aside automatically

The stylesheet is the single source of truth for where a real cursor lives. JS
must not keep its own copy of that list — the two would drift. Instead, ask the
browser on `pointerover`, which fires on element change rather than every move,
so the computed-style read is cheap:

```js
const native = getComputedStyle(e.target).cursor !== 'none';
bubble.classList.toggle('off', native);
dot.classList.toggle('off', native);
```

### 6.5 The wave

A full-viewport `<canvas>` at `z-index:8999`, `pointer-events:none`, created
**only on the landing page**.

```js
const STEP = 24;          // px of travel between ripples
const n = Math.min(Math.floor(d / STEP), 4);
for (let i = 1; i <= n; i++){        // walk the gap
  const t = i / n;
  push(lastX + dx*t, lastY + dy*t, Math.min(d/STEP, 3));
}
```

Interpolating across the gap is essential: a fast flick delivers one `pointermove`
spanning hundreds of pixels, and without this you get a single lonely ring
instead of a trail.

Each ring: `r += 1.9 + force*0.8`, `life -= 0.017`, alpha `life² × 0.30` so it
fades softly. Draw two circles — a gold one at `r` and a paler white one at
`0.82r` — under `globalCompositeOperation = 'lighter'`, which gives the crest
thickness and glow. Cap at 64 rings.

**Gate the wave three ways:** only on the landing page; only while the landing
view is showing (a tool panel is a working surface, ripples across a timeline are
noise); and never where the real cursor is visible.

### 6.6 Desktop only

```js
const mqFine  = matchMedia('(pointer:fine)');
const mqHover = matchMedia('(hover:hover)');
const desktop = () => mqFine.matches && mqHover.matches;
if (!desktop() || matchMedia('(prefers-reduced-motion:reduce)').matches) return;
```

Phones and tablets fail both queries, so **nothing is injected at all** and the
ordinary cursor is untouched. A touch laptop passes, which is right — it has a
trackpad. Listen for `change` on both queries and tear everything down if the
primary pointer stops being a mouse.

**Stop the animation loop when idle.** After the bubble settles and the last ring
dies, let `requestAnimationFrame` stop. An idle tab must cost nothing.

```js
const moving = Math.abs(tx-bx) > 0.1 || Math.abs(ty-by) > 0.1;
if (moving || rings.length) requestAnimationFrame(frame);
else running = false;
```

---

## Part 7 — Scroll reveals

Two attributes, one observer. `data-reveal` marks a block; `data-stage` numbers
the children so they arrive in sequence.

```css
[data-reveal]{ opacity:0; transform:translateY(16px);
  transition:opacity .7s cubic-bezier(.22,.61,.36,1),
             transform .7s cubic-bezier(.22,.61,.36,1); }
[data-reveal].in{ opacity:1; transform:none; }

[data-stage]{ opacity:0; transform:translateY(14px);
  transition:opacity .6s cubic-bezier(.22,.61,.36,1),
             transform .6s cubic-bezier(.22,.61,.36,1); }
[data-reveal].in [data-stage],
[data-reveal].in[data-stage]{ opacity:1; transform:none; }

[data-stage="1"]{ transition-delay:0ms }
[data-stage="2"]{ transition-delay:150ms }
[data-stage="3"]{ transition-delay:300ms }
[data-stage="4"]{ transition-delay:450ms }

@media (prefers-reduced-motion:reduce){
  [data-reveal],[data-stage],.shot.pop{
    opacity:1 !important; transform:none !important; transition:none; }
}
```

Add `.in` with an `IntersectionObserver` configured
`{ rootMargin:'0px 0px -10% 0px', threshold:[0, 0.08] }`, and **unobserve after
firing** — reveals must not replay on scroll-up.

> **Only leaf elements carry a stage.** If a staged container holds staged
> children, the parent's `opacity:0` hides children that believe they are
> visible, and the block never appears. This was a real bug. Stage the leaves.

The picture side of a card gets a heavier entrance:

```css
.shot.pop{
  opacity:0; transform:scale(.965) translateY(18px); filter:blur(6px);
  transition:opacity .95s cubic-bezier(.22,.61,.36,1),
             transform .95s cubic-bezier(.22,.61,.36,1),
             filter .95s cubic-bezier(.22,.61,.36,1),
             border-color .5s ease, box-shadow .5s ease;
  transition-delay:450ms;
}
[data-reveal].in .shot.pop{ opacity:1; transform:none; filter:blur(0); }
```

It is slower than everything else (`.95s`) and starts last (`450ms`), so the
picture always settles after the words. That ordering is deliberate.

---

## Part 8 — The hero

A scroll-scrubbed frame sequence: 80 JPEGs played by scroll position, with the
headline sitting over them.

```css
.herostage{ position:sticky; top:0; height:100vh; overflow:hidden;
  display:flex; align-items:center; justify-content:center; }
```

- The outer section is `height:340vh`; that is the scroll distance, and the
  sticky stage stays put while it passes.
- The canvas is `object-fit:cover` at `opacity:.34` — the frames are a texture
  behind the headline, never a picture competing with it.
- Frames draw to a **`<canvas>`**, not an `<img>`. This matters beyond
  performance: it means a blanket `img{cursor:default}` rule cannot accidentally
  kill the wave across the entire hero.
- Preload every frame before starting, and only ever draw
  `frames[Math.min(total-1, Math.floor(progress * total))]`.
- A frame counter (`Frame 001 / 080`) and a "Rendered locally · nothing uploaded"
  note sit in opposite corners — they make the mechanism legible and restate the
  product's argument at the same time.
- The scroll cue must fade out as the hero scrubs, or it collides with the copy.

---

## Part 9 — Components

**Buttons.** Two only, both square, both uppercase with `.06em` tracking.

```css
.btn-gold{ padding:14px 30px !important; border-radius:2px !important;
  font-size:13px !important; font-weight:700 !important;
  letter-spacing:.06em; text-transform:uppercase; }

.btn-ghost{ background:transparent !important; border:1px solid var(--line) !important;
  color:var(--text) !important; padding:14px 26px !important;
  border-radius:2px !important; font-size:13px !important; font-weight:600 !important;
  letter-spacing:.06em; text-transform:uppercase;
  transition:border-color .35s ease, color .35s ease; }
```

> When a button must be an `<a>` (to open a new tab, or so middle-click works),
> the fill and the padding have to be restated on the anchor — the base rules are
> written for `button` and the UA stylesheet will otherwise strip it back to a
> link. This was missed twice. Also kill `text-decoration`.

**Badges.**

```css
.badge{ display:inline-flex; align-items:center; gap:8px; margin-bottom:20px;
  padding:6px 12px; border:1px solid var(--line); border-radius:2px;
  font-size:10px; letter-spacing:.18em; text-transform:uppercase; color:var(--dim); }
.badge.rare{ background:var(--burgundy); border-color:#4d1a22; color:#E7C7B6; }
```

**Inline "coming soon" chip** — for marking one line inside a list.

```css
.soonchip{ display:inline-block; vertical-align:middle; white-space:nowrap;
  margin-left:7px; padding:2px 7px 3px;
  border:1px solid rgba(198,161,91,.34); border-radius:3px;
  background:rgba(198,161,91,.11); color:var(--accent2);
  font:600 9.5px/1.35 var(--sans);
  letter-spacing:.13em; text-transform:uppercase; }
```

> Named `.soonchip`, not `.chip` — `.chip` already means "a file chip" in the
> tool UI, and the marketing sheet loads second, so a bare `.chip` rule would
> silently restyle every file chip in the app.

**Tool cards.** A grid with no gaps; the border is the shared hairline. Hover
lights the outline from *inside* with `inset box-shadow`, so nothing shifts.

```css
.toolcard{ background:var(--bg); border:0; border-radius:0; text-align:left;
  color:inherit; font:inherit; padding:clamp(26px,3vw,36px);
  display:flex; flex-direction:column;
  position:relative; transition:background .4s ease, box-shadow .45s ease; }
.toolcard:hover{ z-index:2;
  box-shadow:inset 0 0 0 1px rgba(198,161,91,.55),
             0 0 30px rgba(198,161,91,.16),
             0 0 72px rgba(198,161,91,.07); }
```

Each card is numbered `01`–`10` in `--accent` at 9.5px with `.14em` tracking.
Fill an incomplete final row with non-clickable `.toolcard.soon` boxes reading
"More tools soon" — a ragged grid looks unfinished.

> "Glow without a dust effect" means exactly this: an inset ring plus two soft
> outer shadows. No particles, no filter, no blur on the element itself.

**Capability cards.**

```css
.feature{ display:grid; grid-template-columns:1fr 1fr; gap:clamp(36px, 6vw, 92px);
  align-items:center; padding:clamp(48px,7vh,88px) 0; }
```

Alternate sides with an explicit class rather than `:nth-child`, so the order
survives a card being inserted or removed:

```css
.feature.flip .fcopy{ order:2; }
@media (max-width:860px){ .feature.flip .fcopy{ order:0; } }
```

The reset in the media query is required — once the grid is one column, a
reordered copy block would otherwise put the picture above its own heading.

**Coverflow.** Three slides visible; the centre one full size and lit, the
shoulders scaled down and dimmed. Transparent arrows sit over the shoulders, and
dots track position. Clicking the centre slide opens the lightbox — a backdrop
with `blur(22px)` and `cursor:zoom-out` to say a click dismisses it. Verify the
ring maths for every collection size from 2 to 10, not just the size you have.

**Treadmill band.** Three rows of text scrolling at different speeds and
directions above the footer. Duplicate the track exactly and translate by `-50%`
for a seamless loop. `aria-hidden="true"` — it is decoration. Deliberately keeps
the bubble cursor: it is a moving backdrop, not a card.

**Floating actions.** Back-to-top and the assistant, bottom-right, 50px, square,
frosted:

```css
.fab{ position:fixed; right:26px; z-index:210;
  width:50px; height:50px; padding:0 !important; border-radius:2px !important;
  display:flex; align-items:center; justify-content:center;
  border:1px solid var(--line) !important; background:rgba(17,16,15,.86) !important;
  backdrop-filter:blur(14px);
  transition:opacity .45s cubic-bezier(.22,.61,.36,1),
             transform .45s cubic-bezier(.22,.61,.36,1),
             border-color .35s ease, color .35s ease; }
```

Back-to-top appears past roughly one viewport. Watch for collisions with footer
credit text — that has bitten before.

---

## Part 10 — Z-index ladder

Keep to this. Never invent a value between layers.

| Layer | z-index |
|---|---|
| Hero copy / frame labels | 2 |
| Scroll cue | 3 |
| Card hover lift | 2 |
| Coverflow arrows and dots | 20 |
| Nav bar | 200 |
| Floating actions (back to top) | 210 |
| Assistant panel | 215 |
| Account menu | 230 |
| Nav dropdown | 240 |
| Lightbox | 400 |
| Auth modal | 420 |
| Cursor wave canvas | 8999 |
| Cursor bubble | 9000 |
| Cursor dot | 9001 |

The jump from 240 to 400 and from 420 to 8999 is deliberate headroom. The cursor
sits above everything because it must never be occluded by a modal.

---

## Part 11 — Build order

Do it in this order. Each step is verifiable before the next begins.

1. **Tokens and fonts.** `css/app.css` with `:root` and `@font-face`. Verify the
   faces load before writing a single component.
2. **Shell.** `.shell`, `.section`, the hairline separator, `.sechead`.
3. **Typography.** Headings, eyebrow, lede. Check the serif italic renders.
4. **Nav.** Static first. Then `.stuck`, then `.hidden`, then the dropdown.
   Verify `.brand + .navcta` on a page with no link group.
5. **Reveal system.** `data-reveal` + `data-stage` + the observer. Confirm
   reduced-motion resolves everything instantly.
6. **Hero.** Sticky stage, canvas, preload, scrub. Verify the last frame is
   reachable and the cue fades.
7. **Sections.** Capability cards, tool grid, coverflow, treadmill, footer.
8. **Cursor.** Last, because it must be verified *against* everything above.
   Root declaration, then the arrow list, then the bubble, then the wave, then
   the desktop gate. Resolve the cascade before declaring it done.

---

## Part 12 — Pitfalls

Every one of these was hit for real.

**P1 — `cursor` is inherited; never use `*`.** Covered in 6.1. The single most
expensive mistake in this build. It cost three rounds of "the arrow still isn't
showing" because the element was styled correctly and its text was not.

**P2 — Class-name collisions across stylesheets.** The marketing sheet loads
after the app sheet, so any name they share is silently redefined site-wide.
Grep for a class name before you invent it. (`.chip` → `.soonchip`.)

**P3 — Nested staged reveals.** A staged parent hides staged children. Stage
leaves only.

**P4 — Anchors styled as buttons lose the styling.** Restate fill, padding and
`text-decoration:none` on the anchor. Missed twice.

**P5 — Scrolling to a section inside `display:none`.** Zero box, so
`scrollIntoView` does nothing and `preventDefault` has already eaten the click.
Return to the visible view first. Hit twice — once for the logo, once for the nav
links.

**P6 — Heredocs with quotes and apostrophes fail silently.** A "fix" was applied
twice to a file that was never written. Use a Write tool or a `.py` script file
for any content containing quotes.

**P7 — `@media` blocks poison a naive CSS parser.** A verification script that
does not strip them will report the reduced-motion fallback as the winner for
every element.

**P8 — Specificity ties are resolved by source order.** Two rules in this sheet
out-specify a bare tag selector. Name them explicitly rather than hoping.

**P9 — Never wildcard-delete.** Delete by exact filename only.

**P10 — `<audio>` will not decode an octet-stream.** A browser happily sniffs a
mistyped image into an `<img>`, so a MIME table missing `.jpg` looks fine for
years. Audio is strict: serve an mp3 without `audio/mpeg` and it fails to load,
and if the error handler is silent the feature simply appears not to work. Check
the dev server's MIME map before blaming the code, and never swallow a media
`error` event.

**P11 — `node --check` proves syntax, not existence.** Deleting a variable and
leaving two references behind passes the syntax check and then throws
`ReferenceError` at runtime, on every event. After any rename or removal, grep
for the old identifier and run the code path once.

**P12 — Verify against the real cascade, not a screenshot.** Parse both sheets in
load order, compute specificity, model inheritance, and check both the container
*and* its inner text node.

---

## Part 13 — Acceptance checklist

Design is not done until every line passes.

- [ ] No new hex value outside `:root`. The only permitted exceptions are alpha
      overlays derived from a token, and the handful of burgundy and status
      shades that have no token (`#4d1a22`, `#E7C7B6`, `#D9938B`, `#F4D9C8`).
- [ ] No serif heading at a weight other than 400.
- [ ] Every heading ends in a full stop; sentence case throughout.
- [ ] One easing curve, with any exception justified in a comment.
- [ ] Nav: transparent at top, frosted on scroll, hides down, returns up.
- [ ] Nav call to action sits correctly on a page with no link group.
- [ ] Dropdown opens on hover *and* focus; entries have real `href`s.
- [ ] In-page links work while a tool panel is open.
- [ ] Reveals fire once, never replay.
- [ ] Reduced motion resolves everything instantly and injects no cursor.
- [ ] Cursor: arrow on every button, link, image, and visibly bounded box,
      **including their inner text**.
- [ ] Cursor: bubble on all descriptive text that is not inside a box — hero
      copy, section headings, capability headings, paragraphs and facts lists.
- [ ] Cursor: `grab`, `ew-resize`, `crosshair`, I-beam and `not-allowed` all
      survive in the tool UI.
- [ ] Wave runs on the landing page only, and stops when a tool panel opens.
- [ ] Nothing at all is injected on a phone or tablet.
- [ ] Animation loop parks when idle.
- [ ] No horizontal scrollbar at 320px, 768px, 1180px, 1920px.
- [ ] Auth is inert and says so; ratings are not fabricated; payments are
      declared not live.
