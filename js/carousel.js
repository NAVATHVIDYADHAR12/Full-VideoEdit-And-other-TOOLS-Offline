/* carousel.js — a coverflow, plus a lightbox for reading.
 *
 * Three cards are visible at once: the one in focus sits centre, full size,
 * full colour, with a champagne edge; its neighbours sit behind it, smaller,
 * dimmed and desaturated. Moving forward promotes a neighbour rather than
 * sliding a strip of equal cards past the eye.
 *
 * Clicking a neighbour promotes it. Clicking the card already in focus opens it
 * full screen over a blurred page, at full resolution, because these images
 * carry interface text that cannot be read at carousel size.
 *
 * Works on any element carrying data-carousel.
 */
(function () {
'use strict';

/* =============================================================================
 *  Lightbox — built once, shared by every carousel on the page.
 * ========================================================================== */
const Lightbox = (function () {
  let root = null, imgEl = null, countEl = null;
  let ctx = null;                 // { srcs, alts, index, onIndex }
  let lastFocus = null;

  function build(){
    if (root) return;
    root = document.createElement('div');
    root.className = 'lightbox';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.innerHTML =
      '<img class="lbimg" alt="">' +
      '<button type="button" class="lbnav prev" aria-label="Previous">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg></button>' +
      '<button type="button" class="lbnav next" aria-label="Next">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></button>' +
      '<div class="lbcount"></div>' +
      '<div class="lbhint">Click anywhere to close</div>';
    document.body.appendChild(root);

    imgEl = root.querySelector('.lbimg');
    countEl = root.querySelector('.lbcount');

    // clicking anywhere closes, which is the whole interaction
    root.addEventListener('click', close);

    // except the arrows, which would otherwise close the thing they navigate
    root.querySelectorAll('.lbnav').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        step(btn.classList.contains('next') ? 1 : -1);
      });
    });
  }

  function show(i){
    if (!ctx) return;
    const n = ctx.srcs.length;
    ctx.index = ((i % n) + n) % n;
    imgEl.classList.remove('ready');
    imgEl.src = ctx.srcs[ctx.index];
    imgEl.alt = ctx.alts[ctx.index] || '';
    countEl.textContent = (ctx.index + 1) + ' / ' + n;
    // fade in only once the full-resolution file has actually arrived
    if (imgEl.complete) imgEl.classList.add('ready');
    else imgEl.onload = () => imgEl.classList.add('ready');
    if (ctx.onIndex) ctx.onIndex(ctx.index);
  }

  function step(by){ if (ctx) show(ctx.index + by); }

  function open(context){
    build();
    ctx = context;
    lastFocus = document.activeElement;
    show(ctx.index);
    root.classList.add('open');
    // stop the page scrolling underneath the overlay
    document.body.style.overflow = 'hidden';
    root.focus && root.focus();
  }

  function close(){
    if (!root || !root.classList.contains('open')) return;
    root.classList.remove('open');
    document.body.style.overflow = '';
    ctx = null;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  const isOpen = () => !!root && root.classList.contains('open');

  document.addEventListener('keydown', e => {
    if (!isOpen()) return;
    if (e.key === 'Escape'){ e.preventDefault(); close(); }
    if (e.key === 'ArrowLeft'){ e.preventDefault(); step(-1); }
    if (e.key === 'ArrowRight'){ e.preventDefault(); step(1); }
  });

  return { open, close, isOpen };
})();


/* =============================================================================
 *  Coverflow
 * ========================================================================== */
document.querySelectorAll('[data-carousel]').forEach(setup);

function setup(root){
  const slides = [...root.querySelectorAll('.cslide')];
  if (slides.length < 2) return;

  const n = slides.length;
  const dotsBox = root.querySelector('.cdots');
  const prevBtn = root.querySelector('.cnav.prev');
  const nextBtn = root.querySelector('.cnav.next');
  let index = 0;
  let dots = [];

  // the read-size file for each slide, falling back to the carousel copy
  const bigSrcs = slides.map(s => s.dataset.large || s.getAttribute('src'));
  const alts = slides.map(s => s.getAttribute('alt') || '');

  if (dotsBox){
    dots = slides.map((_, k) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cdot';
      b.setAttribute('aria-label', 'Show item ' + (k + 1));
      b.addEventListener('click', () => go(k));
      dotsBox.appendChild(b);
      return b;
    });
  }

  /* Shortest way round the ring, so stepping past the end wraps smoothly
     instead of flying back through every card in between. */
  function offset(k){
    let d = k - index;
    if (d >  n / 2) d -= n;
    if (d < -n / 2) d += n;
    return d;
  }

  function render(){
    slides.forEach((slide, k) => {
      const d = offset(k);
      slide.classList.remove('active', 'prev', 'next', 'far');
      slide.classList.add(d === 0 ? 'active' : d === -1 ? 'prev' : d === 1 ? 'next' : 'far');
      slide.setAttribute('aria-hidden', d === 0 ? 'false' : 'true');
      slide.style.zIndex = String(10 - Math.abs(d));
    });
    dots.forEach((b, k) => b.classList.toggle('on', k === index));
  }

  function go(to){
    index = ((to % n) + n) % n;
    render();
  }
  const step = by => go(index + by);

  if (prevBtn) prevBtn.addEventListener('click', () => step(-1));
  if (nextBtn) nextBtn.addEventListener('click', () => step(1));

  slides.forEach((slide, k) => {
    slide.addEventListener('click', () => {
      // a neighbour gets promoted; the one already in focus opens for reading
      if (offset(k) !== 0) go(k);
      else Lightbox.open({
        srcs: bigSrcs,
        alts: alts,
        index: k,
        onIndex: i => go(i)      // keep the carousel in step with the overlay
      });
    });
  });

  root.tabIndex = 0;
  root.addEventListener('keydown', e => {
    if (Lightbox.isOpen()) return;          // the overlay owns the arrows while open
    if (e.key === 'ArrowLeft'){ e.preventDefault(); step(-1); }
    if (e.key === 'ArrowRight'){ e.preventDefault(); step(1); }
    if (e.key === 'Enter' || e.key === ' '){
      e.preventDefault();
      Lightbox.open({ srcs: bigSrcs, alts: alts, index: index, onIndex: i => go(i) });
    }
  });

  let startX = null;
  root.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive:true });
  root.addEventListener('touchend', e => {
    if (startX == null) return;
    const dx = e.changedTouches[0].clientX - startX;
    startX = null;
    if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
  }, { passive:true });

  render();
}

})();
