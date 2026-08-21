/* carousel.js — a coverflow, not a slider.
 *
 * Three cards are visible at once: the one in focus sits centre, full size,
 * full colour, with a champagne edge; its neighbours sit behind it, smaller,
 * dimmed and desaturated. Moving forward promotes a neighbour rather than
 * sliding a strip of equal cards past the eye.
 *
 * Works on any element carrying data-carousel.
 */
(function () {
'use strict';

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
      // only the focused card is reachable; the rest are decoration for now
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

  // clicking a neighbour promotes it, which is what people try first
  slides.forEach((slide, k) => {
    slide.addEventListener('click', () => { if (offset(k) !== 0) go(k); });
  });

  // arrow keys once the carousel has focus
  root.tabIndex = 0;
  root.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft'){ e.preventDefault(); step(-1); }
    if (e.key === 'ArrowRight'){ e.preventDefault(); step(1); }
  });

  // swipe, for touch
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
