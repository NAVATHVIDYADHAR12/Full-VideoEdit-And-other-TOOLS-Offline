/* icons.js — a mark for each tool, so the grid can be read at a glance.
 *
 * Injected rather than written into the markup: the same grid appears on the
 * landing page and on the collection page, and ten inline SVGs copied into both
 * would drift apart the first time one changed.
 *
 * Thin strokes and currentColor, so they inherit the champagne accent and stay
 * crisp at any size.
 */
(function () {
'use strict';

const ICONS = {
  // layered clips crossed by a playhead
  editor:
    '<rect x="2" y="4" width="12" height="6" rx="1"/>' +
    '<rect x="7" y="14" width="15" height="6" rx="1"/>' +
    '<path d="M18 2v20"/>',

  // a frame with a marked-out region
  wmvideo:
    '<rect x="2.5" y="4.5" width="19" height="15" rx="1"/>' +
    '<rect x="12" y="12" width="7" height="5" stroke-dasharray="2.2 1.8"/>' +
    '<path d="M12.6 16.6 18.4 12.4"/>',

  // film strip
  frames:
    '<rect x="3" y="5" width="18" height="14" rx="1"/>' +
    '<path d="M7.5 5v14M16.5 5v14M3 9.5h4.5M3 14.5h4.5M16.5 9.5H21M16.5 14.5H21"/>',

  // sound lifted out of a frame
  extract:
    '<rect x="2.5" y="5" width="11" height="14" rx="1"/>' +
    '<path d="M6 10v4M9.5 8v8"/>' +
    '<path d="M16 12h5m-2.2-2.2L21 12l-2.2 2.2"/>',

  // speaker, silenced
  mute:
    '<path d="M11 5 6.5 9H3v6h3.5L11 19z"/>' +
    '<path d="m15.5 9.5 5 5M20.5 9.5l-5 5"/>',

  // two streams becoming one
  merge:
    '<path d="M3 6h4c3.5 0 4 6 7.5 6H20"/>' +
    '<path d="M3 18h4c3.5 0 4-6 7.5-6"/>' +
    '<path d="m17.5 9 3 3-3 3"/>',

  // a waveform, cleaned
  denoise:
    '<path d="M2 12h2l2-5 2.5 10L11 9l2 5 2-3h2"/>' +
    '<path d="m19.4 4.8.9 1.9 1.9.9-1.9.9-.9 1.9-.9-1.9-1.9-.9 1.9-.9z"/>',

  // pages gathered into one
  mergepdf:
    '<path d="M8 3h6l4 4v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/>' +
    '<path d="M14 3v4h4"/>' +
    '<path d="M3 7v11a3 3 0 0 0 3 3"/>' +
    '<path d="M10 13h5M10 16.5h3.5"/>',

  // two documents joined
  mergeword:
    '<rect x="2.5" y="3" width="10" height="12.5" rx="1"/>' +
    '<rect x="11.5" y="8.5" width="10" height="12.5" rx="1"/>' +
    '<path d="M5.5 7h4M14.5 15.5h4M14.5 18h2.5"/>',

  // a document, and the two-way arrows that turn it into another
  convert:
    '<path d="M7 3h6l4 4v4"/>' +
    '<path d="M13 3v4h4"/>' +
    '<path d="M7 3a2 2 0 0 0-2 2v6"/>' +
    '<path d="M4 15.5h10m-2.5-2.5 2.5 2.5-2.5 2.5"/>' +
    '<path d="M20 20.5H10m2.5-2.5L10 20.5l2.5 2.5"/>',
};

const KEY_OF = card =>
  card.dataset.go || (card.getAttribute('href') || '').split('#')[1] || '';

document.querySelectorAll('.toolcard').forEach(card => {
  const svg = ICONS[KEY_OF(card)];
  if (!svg || card.querySelector('.ico')) return;

  const top = document.createElement('span');
  top.className = 'ctop';

  const ico = document.createElement('span');
  ico.className = 'ico';
  ico.setAttribute('aria-hidden', 'true');
  ico.innerHTML = '<svg viewBox="0 0 24 24">' + svg + '</svg>';
  top.appendChild(ico);

  // the number keeps its place on the same line, opposite the mark
  const num = card.querySelector('.num');
  if (num){
    card.insertBefore(top, num);
    top.appendChild(num);
  } else {
    card.insertBefore(top, card.firstChild);
  }
});

})();
