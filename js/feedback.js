/* feedback.js — ratings summary, a rating form, and support.
 *
 * ================== READ THIS BEFORE EDITING ==================
 * The numbers below start at zero on purpose.
 *
 * Inventing ratings would mean showing your customers reviews that never
 * happened. That is a lie told to the people most likely to trust you, and it
 * is the kind of thing that is very hard to walk back once it is public.
 *
 * When you have real ratings, put the real counts in RATINGS.breakdown and the
 * section fills itself in: average, star row, total, and the distribution bars.
 * Until then it says plainly that there are none yet, which costs you nothing
 * and is true.
 * ==============================================================
 */
(function () {
'use strict';

/* ---------------------------------------------------------------------------
 *  YOUR REAL NUMBERS GO HERE — how many people gave each score.
 *  Example once you have some:  { 5: 42, 4: 11, 3: 3, 2: 1, 1: 0 }
 * ------------------------------------------------------------------------ */
const RATINGS = {
  breakdown: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
};

const SUPPORT_EMAIL = 'vidyadharnavath989@gmail.com';

const root = document.getElementById('feedback');
if (!root) return;

const $ = sel => root.querySelector(sel);

/* ================= summary ================= */
function starRow(fill, size){
  // one row of five, the last partly filled to match a fractional average
  let html = '<span class="stars" style="--sz:' + size + 'px">';
  for (let i = 0; i < 5; i++){
    const pct = Math.max(0, Math.min(1, fill - i)) * 100;
    html +=
      '<span class="star">' +
        '<svg viewBox="0 0 24 24" class="sbg"><path d="m12 3.6 2.6 5.7 6.2.7-4.6 4.2 1.3 6.1L12 17.2 6.5 20.3l1.3-6.1L3.2 10l6.2-.7z"/></svg>' +
        '<span class="sfill" style="width:' + pct + '%">' +
          '<svg viewBox="0 0 24 24"><path d="m12 3.6 2.6 5.7 6.2.7-4.6 4.2 1.3 6.1L12 17.2 6.5 20.3l1.3-6.1L3.2 10l6.2-.7z"/></svg>' +
        '</span>' +
      '</span>';
  }
  return html + '</span>';
}

function renderSummary(){
  const b = RATINGS.breakdown;
  const total = [5,4,3,2,1].reduce((n, k) => n + (b[k] || 0), 0);
  const sum   = [5,4,3,2,1].reduce((n, k) => n + k * (b[k] || 0), 0);
  const avg   = total ? sum / total : 0;

  const scoreEl = $('[data-fb=score]');
  const starsEl = $('[data-fb=stars]');
  const countEl = $('[data-fb=count]');
  const barsEl  = $('[data-fb=bars]');

  if (!total){
    // honest empty state rather than a flattering fiction
    scoreEl.innerHTML = '&mdash;';
    starsEl.innerHTML = starRow(0, 22);
    countEl.textContent = 'No ratings yet. Be the first.';
    barsEl.innerHTML = '';
    barsEl.classList.add('hide');
    return;
  }

  scoreEl.textContent = avg.toFixed(1);
  starsEl.innerHTML = starRow(avg, 22);
  countEl.textContent = total.toLocaleString() +
                        (total === 1 ? ' rating' : ' ratings');
  barsEl.classList.remove('hide');
  barsEl.innerHTML = [5,4,3,2,1].map(k => {
    const n = b[k] || 0;
    const pct = total ? (n / total) * 100 : 0;
    return '<div class="fbbar">' +
             '<span class="k">' + k + '</span>' +
             '<span class="track"><i style="width:' + pct.toFixed(1) + '%"></i></span>' +
             '<span class="n">' + n + '</span>' +
           '</div>';
  }).join('');
}

/* ================= the rating form ================= */
let chosen = 0;
const pick = $('[data-fb=pick]');
const picked = $('[data-fb=picked]');

function paintPick(value){
  [...pick.children].forEach((b, i) => b.classList.toggle('on', i < value));
}

for (let i = 1; i <= 5; i++){
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pstar';
  b.setAttribute('aria-label', i + ' star' + (i > 1 ? 's' : ''));
  b.innerHTML = '<svg viewBox="0 0 24 24"><path d="m12 3.6 2.6 5.7 6.2.7-4.6 4.2 1.3 6.1L12 17.2 6.5 20.3l1.3-6.1L3.2 10l6.2-.7z"/></svg>';
  b.addEventListener('mouseenter', () => paintPick(i));
  b.addEventListener('focus', () => paintPick(i));
  b.addEventListener('click', () => {
    chosen = i;
    paintPick(i);
    picked.textContent = i + ' out of 5';
  });
  pick.appendChild(b);
}
pick.addEventListener('mouseleave', () => paintPick(chosen));

/* No backend, so this hands the message to the mail client the visitor already
   has. It genuinely sends, which a form posting into nothing would not. */
$('[data-fb=send]').addEventListener('click', () => {
  const msg = $('[data-fb=msg]').value.trim();
  const note = $('[data-fb=note]');

  if (!chosen && !msg){
    note.textContent = 'Pick a rating or write something first.';
    note.className = 'fbnote warn';
    return;
  }

  const subject = 'Atelier Studio feedback' + (chosen ? ' — ' + chosen + '/5' : '');
  const body =
    (chosen ? 'Rating: ' + chosen + ' out of 5\n\n' : '') +
    (msg ? msg + '\n\n' : '') +
    '---\nSent from the feedback form.';

  window.location.href = 'mailto:' + SUPPORT_EMAIL +
    '?subject=' + encodeURIComponent(subject) +
    '&body=' + encodeURIComponent(body);

  note.textContent = 'Opening your email app…';
  note.className = 'fbnote ok';
});

renderSummary();

})();
