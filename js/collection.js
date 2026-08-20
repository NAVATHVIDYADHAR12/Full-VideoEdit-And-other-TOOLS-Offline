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
