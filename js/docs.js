/* docs.js — document tools: merge anything into one PDF, merge Word files,
 * and convert between PDF / Word / images / text.
 *
 * Libraries load lazily from lib/ the first time a tool needs them, so opening
 * the app costs nothing.
 */
(function () {
'use strict';

const C = window.Core, Docx = window.Docx, Zip = window.Zip;
const { el, fmtBytes, escapeHtml, baseName, download, makePicker, buildZip, crc32, idle } = C;

/* ================= lazy library loading ================= */
const loaded = {};
function loadScript(src){
  if (loaded[src]) return loaded[src];
  loaded[src] = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = res;
    s.onerror = () => { loaded[src] = null; rej(new Error('Could not load ' + src)); };
    document.head.appendChild(s);
  });
  return loaded[src];
}
const need = {
  async pdflib(){ await loadScript('lib/pdf-lib.min.js'); return window.PDFLib; },
  async pdfjs(){
    await loadScript('lib/pdf.min.js');
    const lib = window.pdfjsLib;
    lib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
    return lib;
  },
  async mammoth(){ await loadScript('lib/mammoth.browser.min.js'); return window.mammoth; },
};

/* ================= shared helpers ================= */
const PT_PER_TWIP = 1/20;
const extOf = n => (String(n).match(/\.([^.]+)$/) || [,''])[1].toLowerCase();
const isPdf = f => extOf(f.name) === 'pdf';
const isImg = f => /^(jpe?g|png|gif|bmp|webp)$/.test(extOf(f.name));
const isDocx= f => extOf(f.name) === 'docx';
const isTxt = f => /^(txt|md|csv|log)$/.test(extOf(f.name));

/** pdf-lib's standard fonts are WinAnsi only; report what cannot be drawn. */
function toWinAnsi(s, dropped){
  let out = '';
  for (const ch of String(s)){
    const c = ch.codePointAt(0);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)) out += ch;
    else if (c >= 160 && c <= 255) out += ch;
    else if (c === 0x2018 || c === 0x2019) out += "'";
    else if (c === 0x201C || c === 0x201D) out += '"';
    else if (c === 0x2013 || c === 0x2014) out += '-';
    else if (c === 0x2026) out += '...';
    else if (c === 0xA0) out += ' ';
    else { out += '?'; if (dropped) dropped.n++; }
  }
  return out;
}

/** Reorderable file list. */
function fileList(container, files, onChange){
  container.innerHTML = '';
  if (!files.length){
    container.innerHTML = '<div class="note">No files chosen yet.</div>';
    return;
  }
  files.forEach((f, i) => {
    const row = el('div','filerow');
    row.innerHTML =
      '<span class="num">' + (i+1) + '</span>' +
      '<span class="nm">' + escapeHtml(f.name) + '</span>' +
      '<span class="sz">' + fmtBytes(f.size) + '</span>';
    const mk = (txt, title, fn, dis) => {
      const b = el('button','ghost sm');
      b.textContent = txt; b.title = title; b.disabled = !!dis;
      b.onclick = fn;
      return b;
    };
    const acts = el('span','acts');
    acts.append(
      mk('↑','Move up',   () => { [files[i-1],files[i]] = [files[i],files[i-1]]; onChange(); }, i === 0),
      mk('↓','Move down', () => { [files[i+1],files[i]] = [files[i],files[i+1]]; onChange(); }, i === files.length-1),
      mk('✕','Remove',    () => { files.splice(i,1); onChange(); })
    );
    row.appendChild(acts);
    container.appendChild(row);
  });
}

/* ================= PDF page composition ================= */
/** Lay structured blocks out into a new PDF, wrapping and paginating. */
async function blocksToPdf(blocks, opt){
  opt = opt || {};
  const { PDFDocument, StandardFonts, rgb } = await need.pdflib();
  const pdf = opt.into || await PDFDocument.create();
  const F = {
    reg : await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    ital: await pdf.embedFont(StandardFonts.HelveticaOblique),
    bi  : await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  const W = opt.width || 595.28, H = opt.height || 841.89, M = opt.margin || 56;
  const dropped = { n:0 };

  let page = pdf.addPage([W,H]);
  let y = H - M;
  const newPage = () => { page = pdf.addPage([W,H]); y = H - M; };

  for (const b of blocks){
    if (b.type === 'pagebreak'){ newPage(); continue; }

    if (b.type === 'image' && b.bytes){
      const img = b.ext === 'png' ? await pdf.embedPng(b.bytes) : await pdf.embedJpg(b.bytes);
      const maxW = W - M*2, maxH = H - M*2;
      const sc = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = img.width*sc, h = img.height*sc;
      if (y - h < M) newPage();
      page.drawImage(img, { x:(W-w)/2, y:y-h, width:w, height:h });
      y -= h + 12;
      continue;
    }

    const size = b.size || 11;
    const font = b.bold && b.italic ? F.bi : b.bold ? F.bold : b.italic ? F.ital : F.reg;
    const lead = size * 1.35;
    const text = toWinAnsi(b.text == null ? '' : b.text, dropped);

    if (!text.trim()){ y -= lead * 0.6; continue; }

    // greedy word wrap
    const maxW = W - M*2 - (b.indent || 0);
    const words = text.split(/\s+/);
    let line = '';
    const flush = () => {
      if (!line) return;
      if (y - lead < M) newPage();
      let x = M + (b.indent || 0);
      if (b.align === 'center') x = (W - font.widthOfTextAtSize(line, size)) / 2;
      else if (b.align === 'right') x = W - M - font.widthOfTextAtSize(line, size);
      page.drawText(line, { x, y: y - size, size, font, color: rgb(0,0,0) });
      y -= lead;
      line = '';
    };
    for (const word of words){
      const probe = line ? line + ' ' + word : word;
      if (font.widthOfTextAtSize(probe, size) > maxW && line) flush();
      else { line = probe; continue; }
      line = word;
    }
    flush();
    y -= (b.spaceAfter == null ? size * 0.5 : b.spaceAfter);
  }
  return { pdf, dropped: dropped.n };
}

/** Word/HTML -> structured blocks. */
function htmlToBlocks(html){
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks = [];
  const walk = (node, inherited) => {
    for (const child of node.children){
      const tag = child.tagName.toLowerCase();
      const txt = child.textContent.replace(/\s+/g,' ').trim();
      if (/^h[1-6]$/.test(tag)){
        const lvl = +tag[1];
        blocks.push({ text:txt, size: [22,18,15,13,12,11][lvl-1], bold:true, spaceAfter:8, style:'Heading'+Math.min(3,lvl) });
      } else if (tag === 'p'){
        if (txt) blocks.push({ text:txt, size:11, spaceAfter:6 });
      } else if (tag === 'li'){
        blocks.push({ text:'• ' + txt, size:11, indent:18, spaceAfter:2 });
      } else if (tag === 'ul' || tag === 'ol' || tag === 'div' || tag === 'section'){
        walk(child, inherited);
      } else if (tag === 'table'){
        for (const tr of child.querySelectorAll('tr')){
          const cells = [...tr.children].map(td => td.textContent.replace(/\s+/g,' ').trim());
          blocks.push({ text: cells.join('   |   '), size:10, spaceAfter:2 });
        }
        blocks.push({ text:'', size:10 });
      } else if (tag === 'img'){
        // mammoth inlines images as data: URIs
        const src = child.getAttribute('src') || '';
        const m = src.match(/^data:image\/(png|jpe?g);base64,(.+)$/i);
        if (m){
          const bin = atob(m[2]);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          blocks.push({ type:'image', bytes, ext: m[1].toLowerCase().startsWith('p') ? 'png' : 'jpg' });
        }
      } else if (txt){
        blocks.push({ text:txt, size:11, spaceAfter:4 });
      }
    }
  };
  walk(doc.body, {});
  return blocks;
}

/* ================= PDF -> structured content ================= */
/** Reconstruct paragraphs from a PDF's positioned glyphs. */
async function pdfToBlocks(bytes, onProgress){
  const pdfjs = await need.pdfjs();
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const out = [];
  const sizes = [];

  for (let p = 1; p <= doc.numPages; p++){
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items.filter(i => i.str && i.str.trim());

    // group items into lines by baseline y
    const lines = [];
    for (const it of items){
      const t = it.transform;
      const size = Math.hypot(t[2], t[3]) || Math.abs(t[3]) || 11;
      const y = t[5], x = t[4];
      sizes.push(Math.round(size));
      const fn = (it.fontName || '') + '';
      const hit = lines.find(l => Math.abs(l.y - y) < Math.max(2, size * 0.45));
      const piece = { x, str: it.str, size, bold:/bold|black|heavy/i.test(fn), italic:/italic|oblique/i.test(fn) };
      if (hit){ hit.items.push(piece); hit.size = Math.max(hit.size, size); }
      else lines.push({ y, size, items:[piece] });
    }
    lines.sort((a,b) => b.y - a.y);
    for (const l of lines){
      l.items.sort((a,b) => a.x - b.x);
      // re-insert spaces the PDF encoded as positioning rather than characters
      let s = '';
      let prev = null;
      for (const it of l.items){
        if (prev && it.x - prev.x > prev.size * 0.28 && !/\s$/.test(s) && !/^\s/.test(it.str)) s += ' ';
        s += it.str;
        prev = { x: it.x + (it.str.length * it.size * 0.5), size: it.size };
      }
      l.text = s.replace(/\s+/g,' ').trim();
      l.x0 = l.items[0].x;
      l.bold = l.items.every(i => i.bold);
      l.italic = l.items.every(i => i.italic);
    }

    out.push({ page:p, lines: lines.filter(l => l.text) });
    if (onProgress) onProgress(p / doc.numPages);
  }

  // the most common glyph size is the body text size; anything much bigger is a heading
  const modal = sizes.length
    ? +Object.entries(sizes.reduce((m,s) => (m[s] = (m[s]||0)+1, m), {}))
        .sort((a,b) => b[1]-a[1])[0][0]
    : 11;

  // merge lines into paragraphs
  const blocks = [];
  out.forEach((pg, pi) => {
    if (pi > 0) blocks.push({ type:'pagebreak' });
    let cur = null;
    let prev = null;
    for (const l of pg.lines){
      const gap = prev ? (prev.y - l.y) : 0;
      const isHeading = l.size >= modal * 1.22;
      const sameFlow = cur && !isHeading && !cur.isHeading &&
                       gap > 0 && gap < l.size * 1.9 &&
                       Math.abs(l.x0 - cur.x0) < l.size * 1.6;
      if (sameFlow){
        cur.text += ' ' + l.text;
      } else {
        if (cur) blocks.push(cur.block());
        const size = Math.round(l.size * 10) / 10;
        cur = {
          text: l.text, x0: l.x0, isHeading, size,
          block(){
            const b = { text:this.text, size:this.size, bold:l.bold || this.isHeading, italic:l.italic, spaceAfter:6 };
            if (this.isHeading) b.style = this.size >= modal*1.6 ? 'Heading1' : 'Heading2';
            return b;
          }
        };
      }
      prev = l;
    }
    if (cur) blocks.push(cur.block());
  });

  return { blocks, pageCount: out.length, doc };
}

/** Render PDF pages to images. */
async function pdfToImages(bytes, opt, onProgress){
  opt = opt || {};
  const pdfjs = await need.pdfjs();
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const scale = opt.scale || 2;
  const type = opt.type || 'image/jpeg';
  const quality = opt.quality == null ? 0.88 : opt.quality;
  const pages = [];

  for (let p = 1; p <= doc.numPages; p++){
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const blob = await new Promise(r => canvas.toBlob(r, type, quality));
    const base = page.getViewport({ scale:1 });
    pages.push({ blob, widthPt: base.width, heightPt: base.height, index:p });
    if (onProgress) onProgress(p / doc.numPages);
    await idle();
  }
  return pages;
}

window.DocsLib = { need, blocksToPdf, htmlToBlocks, pdfToBlocks, pdfToImages,
                   fileList, toWinAnsi, isPdf, isImg, isDocx, isTxt, extOf };
})();
