/* docs.js — document tools: merge anything into one PDF, merge Word files,
 * and convert between PDF / Word / images / text.
 *
 * Libraries load lazily from lib/ the first time a tool needs them, so opening
 * the app costs nothing.
 */
(function () {
'use strict';

const C = window.Core;
const { el, fmtBytes, escapeHtml, idle } = C;

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
      let img;
      try {
        img = b.ext === 'png' ? await pdf.embedPng(b.bytes) : await pdf.embedJpg(b.bytes);
      } catch(_){ continue; }
      const maxW = W - M*2, maxH = H - M*2;
      const sc = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = img.width*sc, h = img.height*sc;
      if (y - h < M) newPage();
      page.drawImage(img, { x:(W-w)/2, y:y-h, width:w, height:h });
      y -= h + 12;
      continue;
    }

    if (b.type === 'table' && b.rows && b.rows.length){
      const cols = Math.max(...b.rows.map(r => r.length));
      const cw = (W - M*2) / cols;
      const size = 9, lead = size * 1.3;
      for (let ri = 0; ri < b.rows.length; ri++){
        if (y - lead < M) newPage();
        const row = b.rows[ri];
        const font = (b.headerRow && ri === 0) ? F.bold : F.reg;
        for (let ci = 0; ci < cols; ci++){
          let cell = toWinAnsi(row[ci] == null ? '' : row[ci], dropped);
          while (cell && font.widthOfTextAtSize(cell, size) > cw - 6) cell = cell.slice(0, -1);
          page.drawText(cell, { x: M + ci*cw + 3, y: y - size, size, font, color: rgb(0,0,0) });
        }
        y -= lead;
      }
      y -= 8;
      continue;
    }

    const size = b.size || 11;
    const font = b.bold && b.italic ? F.bi : b.bold ? F.bold : b.italic ? F.ital : F.reg;
    const lead = size * 1.35;
    const text = toWinAnsi(b.text == null ? '' : b.text, dropped);

    if (!text.trim()){ y -= lead * 0.6; continue; }

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
  const walk = node => {
    for (const child of node.children){
      const tag = child.tagName.toLowerCase();
      const txt = child.textContent.replace(/\s+/g,' ').trim();
      if (/^h[1-6]$/.test(tag)){
        const lvl = +tag[1];
        blocks.push({ text:txt, size:[22,18,15,13,12,11][lvl-1], bold:true, spaceAfter:8,
                      style:'Heading' + Math.min(3,lvl) });
      } else if (tag === 'p'){
        if (txt) blocks.push({ text:txt, size:11, spaceAfter:6 });
      } else if (tag === 'li'){
        blocks.push({ text:'• ' + txt, size:11, indent:18, spaceAfter:2 });
      } else if (tag === 'ul' || tag === 'ol' || tag === 'div' || tag === 'section'){
        walk(child);
      } else if (tag === 'table'){
        const rows = [...child.querySelectorAll('tr')].map(tr =>
          [...tr.children].map(td => td.textContent.replace(/\s+/g,' ').trim()));
        if (rows.length) blocks.push({ type:'table', rows, headerRow:true });
      } else if (tag === 'img'){
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
  walk(doc.body);
  return blocks;
}

/* ================= PDF -> structured content =================
 * A PDF stores positioned glyphs and image XObjects, not paragraphs. This
 * rebuilds structure from that: runs keep their own bold/italic/size, embedded
 * images are pulled out as real pictures, and column-aligned rows become tables.
 */

/** Multiply two PDF transform matrices [a,b,c,d,e,f]. */
function mul(m, n){
  return [
    m[0]*n[0] + m[2]*n[1],  m[1]*n[0] + m[3]*n[1],
    m[0]*n[2] + m[2]*n[3],  m[1]*n[2] + m[3]*n[3],
    m[0]*n[4] + m[2]*n[5] + m[4],  m[1]*n[4] + m[3]*n[5] + m[5]
  ];
}

/** Resolve a pdf.js object that may not have arrived yet. */
function getObj(page, name){
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done){ done = true; resolve(v || null); } };
    try {
      if (page.objs.has && page.objs.has(name)) return finish(page.objs.get(name));
      page.objs.get(name, finish);
      setTimeout(() => finish(null), 4000);
    } catch(_){ finish(null); }
  });
}

/** pdf.js image object -> canvas. */
function imageToCanvas(img){
  if (!img) return null;
  const w = img.width, h = img.height;
  if (!w || !h) return null;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');

  if (img.bitmap){                        // newer pdf.js hands back an ImageBitmap
    ctx.drawImage(img.bitmap, 0, 0);
    return cv;
  }
  const src = img.data;
  if (!src) return null;
  const id = ctx.createImageData(w, h), dst = id.data, n = w*h;
  if (src.length === n*4) dst.set(src);
  else if (src.length === n*3){
    for (let i = 0, j = 0; i < n; i++){
      dst[i*4] = src[j++]; dst[i*4+1] = src[j++]; dst[i*4+2] = src[j++]; dst[i*4+3] = 255;
    }
  } else if (src.length === n){
    for (let i = 0; i < n; i++){ dst[i*4] = dst[i*4+1] = dst[i*4+2] = src[i]; dst[i*4+3] = 255; }
  } else return null;
  ctx.putImageData(id, 0, 0);
  return cv;
}

/** Walk a page's operator list, pulling out every painted raster image and where it sits. */
async function extractImages(page, pdfjs){
  const OPS = pdfjs.OPS;
  let ops;
  try { ops = await page.getOperatorList(); } catch(_){ return []; }

  const found = [];
  let ctm = [1,0,0,1,0,0];
  const stack = [];
  for (let i = 0; i < ops.fnArray.length; i++){
    const fn = ops.fnArray[i], args = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm.slice());
    else if (fn === OPS.restore) ctm = stack.pop() || [1,0,0,1,0,0];
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject)
      found.push({ name: args[0], m: ctm.slice() });
    else if (fn === OPS.paintInlineImageXObject)
      found.push({ obj: args[0], m: ctm.slice() });
  }

  const out = [];
  for (const f of found){
    try {
      const img = f.obj || await getObj(page, f.name);
      const cv = imageToCanvas(img);
      if (!cv) continue;
      const wPt = Math.hypot(f.m[0], f.m[1]);
      const hPt = Math.hypot(f.m[2], f.m[3]);
      if (wPt < 8 || hPt < 8) continue;              // rules, bullets, spacer pixels
      const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
      if (!blob) continue;
      out.push({
        bytes: new Uint8Array(await blob.arrayBuffer()), ext:'png',
        widthPt: wPt, heightPt: hPt,
        x: f.m[4], y: f.m[5],                        // PDF origin is bottom-left
        top: f.m[5] + hPt
      });
    } catch(_){ /* one bad image must not sink the page */ }
  }
  return out;
}

/** Recover tables from lines whose items share the same column positions. */
function detectTables(lines){
  const isRow = l => {
    if (l.items.length < 2) return false;
    for (let k = 1; k < l.items.length; k++)
      if (l.items[k].x - (l.items[k-1].x + l.items[k-1].w) > l.size * 1.2) return true;
    return false;
  };
  const spans = [];
  let i = 0;
  while (i < lines.length){
    if (!isRow(lines[i])){ i++; continue; }
    let j = i;
    while (j + 1 < lines.length && isRow(lines[j+1])) j++;

    if (j - i + 1 >= 3){
      const rows = lines.slice(i, j+1);
      const xs = [];
      rows.forEach(r => r.items.forEach(it => xs.push(it.x)));
      xs.sort((a,b) => a-b);
      const tol = Math.max(6, rows[0].size * 1.1);
      const cols = [];
      for (const x of xs){
        const c = cols.find(c => Math.abs(c.x - x) < tol);
        if (c){ c.n++; c.x = (c.x*(c.n-1) + x)/c.n; } else cols.push({ x, n:1 });
      }
      const strong = cols.filter(c => c.n >= rows.length * 0.6).sort((a,b) => a.x-b.x);
      if (strong.length >= 2){
        spans.push({ from:i, to:j, cols: strong.map(c => c.x) });
        i = j + 1;
        continue;
      }
    }
    i = j + 1;
  }
  return spans;
}

function rowsFromSpan(lines, span){
  return lines.slice(span.from, span.to + 1).map(l => {
    const cells = Array(span.cols.length).fill('');
    for (const it of l.items){
      let best = 0, bd = Infinity;
      span.cols.forEach((cx, ci) => { const d = Math.abs(cx - it.x); if (d < bd){ bd = d; best = ci; } });
      cells[best] = (cells[best] ? cells[best] + ' ' : '') + it.str;
    }
    return cells.map(c => c.trim());
  });
}

/** A paragraph accumulates lines while keeping each run's own formatting. */
function makePara(line, isHeading, modal){
  const runs = [];
  const add = l => {
    if (runs.length) runs.push({ text:' ', size:l.size });
    for (const it of l.items){
      const last = runs[runs.length-1];
      if (last && !!last.bold === !!it.bold && !!last.italic === !!it.italic &&
          Math.abs((last.size||0) - it.size) < 0.6){
        last.text += it.str;
      } else {
        runs.push({ text:it.str, bold:it.bold, italic:it.italic, size:Math.round(it.size*10)/10 });
      }
    }
  };
  const o = {
    x0: line.x0, lastY: line.y, isHeading, size: Math.round(line.size*10)/10,
    push(l){ add(l); o.lastY = l.y; },
    build(){
      return {
        type:'p', spaceAfter:6,
        style: isHeading ? (o.size >= modal*1.6 ? 'Heading1' : 'Heading2') : undefined,
        runs: runs.map(r => ({ text:r.text, bold:r.bold, italic:r.italic,
                               size: isHeading ? undefined : r.size }))
      };
    }
  };
  add(line);
  return o;
}

/** @returns {{blocks:Array, stats:object, pageCount:number}} */
async function pdfToBlocks(bytes, onProgress, opt){
  opt = opt || {};
  const pdfjs = await need.pdfjs();
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const stats = { pages: doc.numPages, textItems:0, images:0, tables:0, scannedPages:0 };
  const perPage = [];
  const sizes = [];

  for (let p = 1; p <= doc.numPages; p++){
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale:1 });
    const tc = await page.getTextContent();
    const items = tc.items.filter(i => i.str && i.str.trim());
    stats.textItems += items.length;

    const images = opt.images === false ? [] : await extractImages(page, pdfjs);
    stats.images += images.length;

    // pictures but no text means a scan — there is nothing to make editable
    if (!items.length && images.length) stats.scannedPages++;

    const lines = [];
    for (const it of items){
      const t = it.transform;
      const size = Math.hypot(t[2], t[3]) || Math.abs(t[3]) || 11;
      const y = t[5], x = t[4];
      sizes.push(Math.round(size));
      const fn = String(it.fontName || '');
      // pdf.js reports the real advance width — far better than guessing from length
      const w = it.width != null ? it.width : it.str.length * size * 0.5;
      const piece = { x, w, str:it.str, size,
                      bold:/bold|black|heavy|semib/i.test(fn), italic:/italic|oblique/i.test(fn) };
      const hit = lines.find(l => Math.abs(l.y - y) < Math.max(2, size * 0.45));
      if (hit){ hit.items.push(piece); hit.size = Math.max(hit.size, size); }
      else lines.push({ y, size, items:[piece] });
    }
    lines.sort((a,b) => b.y - a.y);
    for (const l of lines){
      l.items.sort((a,b) => a.x - b.x);
      l.x0 = l.items.length ? l.items[0].x : 0;
      l.text = l.items.map((it, i) => {
        const prev = l.items[i-1];
        const gap = prev ? it.x - (prev.x + prev.w) : 0;
        return (prev && gap > it.size * 0.22 && !/\s$/.test(prev.str) && !/^\s/.test(it.str)
                ? ' ' : '') + it.str;
      }).join('').replace(/\s+/g,' ').trim();
    }
    perPage.push({ lines: lines.filter(l => l.text), images, height: vp.height });
    if (onProgress) onProgress(p / doc.numPages);
    await idle();
  }

  const modal = sizes.length
    ? +Object.entries(sizes.reduce((m,s) => (m[s] = (m[s]||0)+1, m), {}))
        .sort((a,b) => b[1]-a[1])[0][0]
    : 11;

  const blocks = [];
  perPage.forEach((pg, pi) => {
    if (pi > 0) blocks.push({ type:'pagebreak' });

    const spans = opt.tables === false ? [] : detectTables(pg.lines);
    stats.tables += spans.length;

    // interleave text and images by vertical position
    const flow = [];
    pg.lines.forEach((l, idx) => flow.push({ y:l.y, kind:'line', l, idx }));
    pg.images.forEach(im => flow.push({ y:im.top, kind:'image', im }));
    flow.sort((a,b) => b.y - a.y);

    let para = null;
    const flushPara = () => { if (para){ blocks.push(para.build()); para = null; } };
    const emitted = new Set();

    for (const node of flow){
      if (node.kind === 'image'){
        flushPara();
        blocks.push({ type:'image', bytes:node.im.bytes, ext:node.im.ext,
                      widthPt:node.im.widthPt, heightPt:node.im.heightPt });
        continue;
      }
      const span = spans.find(s => node.idx >= s.from && node.idx <= s.to);
      if (span){
        flushPara();
        if (!emitted.has(span)){
          emitted.add(span);
          blocks.push({ type:'table', rows: rowsFromSpan(pg.lines, span), headerRow:true });
        }
        continue;
      }
      const l = node.l;
      const isHeading = l.size >= modal * 1.22;
      const gap = para ? para.lastY - l.y : 0;
      const sameFlow = para && !isHeading && !para.isHeading &&
                       gap > 0 && gap < l.size * 1.9 &&
                       Math.abs(l.x0 - para.x0) < l.size * 1.6;
      if (sameFlow){ para.push(l); continue; }
      flushPara();
      para = makePara(l, isHeading, modal);
    }
    flushPara();
  });

  return { blocks, stats, pageCount: perPage.length };
}

/** Quick look inside a PDF so the UI can say what it found before converting. */
async function analyzePdf(bytes){
  const pdfjs = await need.pdfjs();
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const s = { pages: doc.numPages, textItems:0, images:0, scannedPages:0 };
  const limit = Math.min(doc.numPages, 8);          // sampling is enough to classify
  for (let p = 1; p <= limit; p++){
    const page = await doc.getPage(p);
    const items = (await page.getTextContent()).items.filter(i => i.str && i.str.trim());
    const imgs = await extractImages(page, pdfjs);
    s.textItems += items.length;
    s.images += imgs.length;
    if (!items.length) s.scannedPages++;
  }
  s.sampled = limit;
  s.scanned = s.textItems === 0;                    // no text anywhere we looked
  return s;
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

window.DocsLib = { need, blocksToPdf, htmlToBlocks, pdfToBlocks, pdfToImages, analyzePdf,
                   extractImages, detectTables, fileList, toWinAnsi,
                   isPdf, isImg, isDocx, isTxt, extOf };
})();
