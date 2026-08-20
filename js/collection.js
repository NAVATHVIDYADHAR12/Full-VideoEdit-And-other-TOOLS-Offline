/* collection.js — the entrance sequence for the collection page.
 *
 * Time-based rather than scroll-based: this page has one job, and the reader
 * should watch the set assemble itself the moment it opens.
 */
(function () {
'use strict';

const reduced = window.matchMedia &&
                window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const header = [...document.querySelectorAll('[data-intro]')]
  .sort((a, b) => +a.dataset.intro - +b.dataset.intro);
const cards  = [...document.querySelectorAll('#grid .toolcard')];
const tail   = header.filter(n => +n.dataset.intro > 3);
const lead   = header.filter(n => +n.dataset.intro <= 3);

if (reduced){
  [...header, ...cards].forEach(n => n.classList.add('in'));
} else {
  let t = 120;
  const step = (node, gap) => { setTimeout(() => node.classList.add('in'), t); t += gap; };

  // eyebrow, then the heading, then the line underneath it
  lead.forEach(n => step(n, 150));

  t += 140;
  cards.forEach(n => step(n, 85));      // then the set deals itself out, one by one

  t += 120;
  tail.forEach(n => step(n, 100));
}

/* A card that is still arriving should not be clickable mid-flight. */
document.addEventListener('click', e => {
  const card = e.target.closest && e.target.closest('.toolcard');
  if (card && !card.classList.contains('in')) e.preventDefault();
});

})();

/* ================= back to top =================
 * Same behaviour as the landing page: it appears on the way down and steps
 * aside on the way up, and holds still while the pointer is over it so it
 * cannot vanish mid-click.
 */
(function () {
  const toTop = document.getElementById('totop');
  const nav   = document.getElementById('nav');
  if (!toTop && !nav) return;
  let lastY = window.scrollY, shown = false, over = false, hidden = false;

  const set = on => {
    if (on === shown || !toTop) return;
    shown = on;
    toTop.classList.toggle('show', on);
  };
  const setNav = on => {
    if (on === hidden || !nav) return;
    hidden = on;
    nav.classList.toggle('hidden', on);
  };

  // one handler for both: the bar steps aside on the way down and the return
  // button takes its place, exactly as on the landing page
  window.addEventListener('scroll', () => {
    const y = Math.max(0, window.scrollY);
    if (y < 140){ lastY = y; setNav(false); if (!over) set(false); return; }
    const dy = y - lastY;
    if (Math.abs(dy) < 6) return;
    lastY = y;
    const down = dy > 0;
    setNav(down);
    if (!over) set(down);
  }, { passive:true });

  toTop.addEventListener('pointerenter', () => { over = true; });
  toTop.addEventListener('pointerleave', () => { over = false; });
  toTop.addEventListener('click', () => {
    window.scrollTo({ top:0, behavior:'smooth' });
    set(false);
  });
})();
