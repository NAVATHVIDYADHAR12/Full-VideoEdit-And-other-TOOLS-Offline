/* pptx.js — PowerPoint (.pptx) to PDF, entirely in the browser.
 *
 * WHAT THIS IS
 * A .pptx is not a mysterious binary: it is a ZIP of OOXML, the same family as
 * the .docx this app already reads. Each slide is an XML file describing shapes
 * at absolute positions in EMU (English Metric Units, 914400 per inch). So a
 * slide maps onto a PDF page almost directly: convert EMU to points, walk the
 * shape tree, and draw. That is what this file does, with pdf-lib.
 *
 * HOW POWERPOINT ACTUALLY COMPOSES A SLIDE
 * A slide is the top layer of three. The master carries the background and the
 * furniture -- colour bands, rules, logos. The layout adds its own on top. The
 * slide adds the content. Render only the slide and you get text floating on
 * white: no background, no colour boxes, and text in whatever colour the run
 * happened to state. This file draws all three layers in order, which is what
 * PowerPoint does, and honours showMasterSp when a slide opts out.
 *
 * Colour is inherited the same way. A run with no colour of its own takes it
 * from the layout placeholder's list style, then the master's txStyles, then
 * the theme. A shape with no fill of its own may take one from its <p:style>
 * fillRef. Reading only what the slide states leaves almost everything black.
 *
 * WHAT IT HANDLES
 *   - true slide size and aspect ratio, one PDF page per slide
 *   - text boxes: runs, point sizes, bold, italic, colour, alignment, wrapping,
 *     vertical anchoring, line breaks and bullets
 *   - placeholders whose position lives on the layout or master, not the slide
 *   - pictures (PNG and JPEG), positioned and scaled as authored
 *   - solid-filled shapes, outlines, and rounded/elliptical geometry
 *   - tables from graphic frames
 *   - grouped shapes, including the child-offset transform they carry
 *   - solid slide backgrounds, inherited from layout and master
 *   - theme colours, so schemeClr references resolve to the right hex
 *
 * WHAT IT DOES NOT, AND WILL NOT PRETEND TO
 *   Animations and transitions (meaningless in a PDF), SmartArt, charts,
 *   gradient and picture fills, WordArt effects, shadows, 3-D, embedded video,
 *   and EMF/WMF vector images. Shapes it cannot draw are counted and reported
 *   rather than silently dropped, so the caller can say what was approximated.
 *
 * LEGACY .ppt IS A DIFFERENT FILE FORMAT ENTIRELY — a binary compound document
 * from the 1990s, not a ZIP. It is not supported here and should be rejected by
 * the caller with that explanation.
 */
(function (root) {
'use strict';

const PT = 12700;                     // EMU per point
const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
};

/* ================= tiny XML helpers ================= */
const dec = new TextDecoder();
function parseXml(bytes){
  if (!bytes) return null;
  const doc = new DOMParser().parseFromString(dec.decode(bytes), 'application/xml');
  return doc.getElementsByTagName('parsererror').length ? null : doc;
}
/** direct element children with this namespace + local name */
function kids(node, ns, local){
  const out = [];
  if (!node) return out;
  for (let n = node.firstElementChild; n; n = n.nextElementSibling){
    if (n.namespaceURI === NS[ns] && n.localName === local) out.push(n);
  }
  return out;
}
const kid  = (node, ns, local) => kids(node, ns, local)[0] || null;
/** first descendant, at any depth */
function find(node, ns, local){
  if (!node) return null;
  const l = node.getElementsByTagNameNS(NS[ns], local);
  return l.length ? l[0] : null;
}
const findAll = (node, ns, local) =>
  node ? Array.prototype.slice.call(node.getElementsByTagNameNS(NS[ns], local)) : [];
const attr = (n, name, dflt) => (n && n.hasAttribute(name)) ? n.getAttribute(name) : dflt;
const num  = (n, name, dflt) => { const v = attr(n, name); return v == null ? dflt : (parseFloat(v) || 0); };

/* ================= relationships ================= */
function relsFor(files, partName){
  const i = partName.lastIndexOf('/');
  const rp = partName.slice(0, i) + '/_rels' + partName.slice(i) + '.rels';
  const doc = parseXml(files.get(rp));
  const map = new Map();
  if (!doc) return map;
  for (const rel of doc.getElementsByTagNameNS(NS.rel, 'Relationship')){
    map.set(attr(rel, 'Id'), { target: attr(rel, 'Target'), type: attr(rel, 'Type') });
  }
  return map;
}
/** resolve a relationship target against the part that referenced it */
function resolvePath(fromPart, target){
  if (!target) return null;
  if (target.startsWith('/')) return target.slice(1);
  const base = fromPart.slice(0, fromPart.lastIndexOf('/') + 1);
  const parts = (base + target).split('/');
  const out = [];
  for (const seg of parts){
    if (seg === '.' || seg === '') continue;
    if (seg === '..') out.pop(); else out.push(seg);
  }
  return out.join('/');
}

/* ================= colour ================= */
const HEXC = { black:'000000', white:'FFFFFF', red:'FF0000', green:'008000', blue:'0000FF',
               yellow:'FFFF00', gray:'808080', grey:'808080' };

/** Read a colour out of a <a:solidFill>-style container. */
function colorOf(node, theme){
  if (!node) return null;
  const srgb = find(node, 'a', 'srgbClr');
  if (srgb) return applyMods(attr(srgb, 'val'), srgb);
  const scheme = find(node, 'a', 'schemeClr');
  if (scheme){
    const key = attr(scheme, 'val');
    const hex = theme && theme[key];
    if (hex) return applyMods(hex, scheme);
  }
  const sys = find(node, 'a', 'sysClr');
  if (sys) return applyMods(attr(sys, 'lastClr') || '000000', sys);
  const pre = find(node, 'a', 'prstClr');
  if (pre) return applyMods(HEXC[attr(pre, 'val')] || '000000', pre);
  return null;
}
/** lumMod / lumOff are common enough in real decks to be worth honouring. */
function applyMods(hex, node){
  let c = hexToRgb(hex);
  if (!c) return null;
  const lumMod = find(node, 'a', 'lumMod'), lumOff = find(node, 'a', 'lumOff');
  const shade  = find(node, 'a', 'shade'),  tint   = find(node, 'a', 'tint');
  if (lumMod){ const f = num(lumMod, 'val', 100000) / 100000; c = { r:c.r*f, g:c.g*f, b:c.b*f }; }
  if (lumOff){ const f = num(lumOff, 'val', 0) / 100000; c = { r:c.r+f, g:c.g+f, b:c.b+f }; }
  if (shade){  const f = num(shade, 'val', 100000) / 100000; c = { r:c.r*f, g:c.g*f, b:c.b*f }; }
  if (tint){   const f = num(tint,  'val', 100000) / 100000;
               c = { r:c.r*f + (1-f), g:c.g*f + (1-f), b:c.b*f + (1-f) }; }
  return { r: clamp01(c.r), g: clamp01(c.g), b: clamp01(c.b) };
}
const clamp01 = v => Math.min(1, Math.max(0, v));
function hexToRgb(h){
  if (!h) return null;
  h = String(h).replace('#','');
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  if (isNaN(n)) return null;
  return { r: ((n>>16)&255)/255, g: ((n>>8)&255)/255, b: (n&255)/255 };
}

/** A gradient cannot be drawn as one, so take the stop nearest the middle:
    it reads closer to the overall impression than either extreme. */
function gradColor(grad, theme){
  if (!grad) return null;
  const stops = findAll(grad, 'a', 'gs');
  if (!stops.length) return null;
  let best = stops[0], bestD = 1e9;
  for (const gs of stops){
    const pos = num(gs, 'pos', 0) / 1000;
    const d = Math.abs(pos - 50);
    if (d < bestD){ bestD = d; best = gs; }
  }
  return colorOf(best, theme);
}

/** The fill for a shape: what it states, else what its style points at. */
function fillOf(spPr, style, theme){
  if (kid(spPr, 'a', 'noFill')) return null;
  const solid = kid(spPr, 'a', 'solidFill');
  if (solid) return colorOf(solid, theme);
  const grad = kid(spPr, 'a', 'gradFill');
  if (grad) return gradColor(grad, theme);
  if (kid(spPr, 'a', 'blipFill') || kid(spPr, 'a', 'pattFill')) return null;
  // no fill stated at all -> the shape's style reference decides
  const ref = style ? kid(style, 'a', 'fillRef') : null;
  if (ref && num(ref, 'idx', 0) > 0) return colorOf(ref, theme);
  return null;
}

/** The background of a slide, layout or master part. */
function bgFillOf(doc, theme){
  if (!doc) return null;
  const bg = find(doc, 'p', 'bg');
  if (!bg) return null;
  const bgPr = kid(bg, 'p', 'bgPr');
  if (bgPr){
    if (kid(bgPr, 'a', 'noFill')) return null;
    const solid = kid(bgPr, 'a', 'solidFill');
    if (solid) return colorOf(solid, theme);
    const grad = kid(bgPr, 'a', 'gradFill');
    if (grad) return gradColor(grad, theme);
    return null;                        // picture background: cannot reproduce
  }
  // <p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef>
  const ref = kid(bg, 'p', 'bgRef');
  if (ref) return colorOf(ref, theme);
  return null;
}

/** theme1.xml -> { dk1, lt1, accent1..6, hlink, ... } as hex strings */
function themeColors(doc){
  const out = {};
  const scheme = find(doc, 'a', 'clrScheme');
  if (!scheme) return out;
  for (let n = scheme.firstElementChild; n; n = n.nextElementSibling){
    const srgb = kid(n, 'a', 'srgbClr'), sys = kid(n, 'a', 'sysClr');
    const hex = srgb ? attr(srgb, 'val') : sys ? (attr(sys, 'lastClr') || '000000') : null;
    if (hex) out[n.localName] = hex;
  }
  // PowerPoint swaps these two pairs when referring to them from slides
  out.tx1 = out.tx1 || out.dk1; out.bg1 = out.bg1 || out.lt1;
  out.tx2 = out.tx2 || out.dk2; out.bg2 = out.bg2 || out.lt2;
  return out;
}

/* ================= text that Helvetica can actually draw ================= */
function toWinAnsi(s, dropped){
  let out = '';
  for (const ch of String(s)){
    const c = ch.codePointAt(0);
    if (c === 9) out += '    ';
    else if ((c >= 32 && c <= 126) || (c >= 160 && c <= 255)) out += ch;
    else if (c === 0x2018 || c === 0x2019) out += "'";
    else if (c === 0x201C || c === 0x201D) out += '"';
    else if (c === 0x2013 || c === 0x2014) out += '-';
    else if (c === 0x2022) out += '·';
    else if (c === 0x2026) out += '...';
    else if (c === 0xA0) out += ' ';
    else if (c < 32) { /* drop control characters silently */ }
    else { out += '?'; if (dropped) dropped.n++; }
  }
  return out;
}

/* ================= inherited text styling ================= */
/* The master's <p:txStyles> is where a placeholder's real size, weight and
   colour live. A run that states none of its own inherits from here, by
   placeholder family and outline level. Without this every line comes out
   12pt black, which on a dark background is invisible. */
function txStylesOf(masterDoc){
  const out = { title: [], body: [], other: [] };
  if (!masterDoc) return out;
  const styles = find(masterDoc, 'p', 'txStyles');
  if (!styles) return out;
  const grab = (tag, into) => {
    const node = kid(styles, 'p', tag);
    if (!node) return;
    for (let i = 1; i <= 9; i++){
      const lvl = kid(node, 'a', 'lvl' + i + 'pPr');
      const def = lvl ? kid(lvl, 'a', 'defRPr') : null;
      into[i - 1] = def ? {
        size: def.hasAttribute('sz') ? num(def, 'sz', 1800) / 100 : null,
        bold: attr(def, 'b') === '1',
        ital: attr(def, 'i') === '1',
        col : colorOf(kid(def, 'a', 'solidFill'), null),   // theme applied later
        colNode: kid(def, 'a', 'solidFill'),
        align: lvl ? attr(lvl, 'algn', null) : null,
      } : null;
    }
  };
  grab('titleStyle', out.title);
  grab('bodyStyle',  out.body);
  grab('otherStyle', out.other);
  return out;
}

/** Which family of master style applies to this shape. */
function styleFamily(sp){
  const ph = find(sp, 'p', 'ph');
  if (!ph) return 'other';
  const t = attr(ph, 'type', 'body');
  return (t === 'title' || t === 'ctrTitle') ? 'title'
       : (t === 'sldNum' || t === 'ftr' || t === 'dt') ? 'other' : 'body';
}

/** A placeholder's own list style on the layout, which beats the master. */
function lstStyleOf(sp){
  const tx = kid(sp, 'p', 'txBody');
  return tx ? kid(tx, 'a', 'lstStyle') : null;
}

/* ================= geometry ================= */
/** Read <a:xfrm> into points, or null when the shape inherits its position. */
function xfrmOf(spPr){
  const x = find(spPr, 'a', 'xfrm');
  if (!x) return null;
  const off = kid(x, 'a', 'off'), ext = kid(x, 'a', 'ext');
  if (!off || !ext) return null;
  return {
    x: num(off, 'x', 0) / PT,
    y: num(off, 'y', 0) / PT,
    w: num(ext, 'cx', 0) / PT,
    h: num(ext, 'cy', 0) / PT,
    rot: num(x, 'rot', 0) / 60000,
    flipH: attr(x, 'flipH') === '1',
    flipV: attr(x, 'flipV') === '1',
  };
}

/** Placeholder identity, used to inherit position from layout then master. */
function phKeyOf(sp){
  const ph = find(sp, 'p', 'ph');
  if (!ph) return null;
  const type = attr(ph, 'type', 'body');
  const idx  = attr(ph, 'idx', '');
  return type + '#' + idx;
}

/** Build (placeholder -> xfrm) for a layout or master part. */
function placeholderMap(doc){
  const map = new Map();
  if (!doc) return map;
  const tree = find(doc, 'p', 'spTree');
  if (!tree) return map;
  for (const sp of findAll(tree, 'p', 'sp')){
    const key = phKeyOf(sp);
    if (!key) continue;
    const box = xfrmOf(kid(sp, 'p', 'spPr'));
    if (box) {
      map.set(key, box);
      // also index by bare type, so idx mismatches still find something sane
      const bare = key.split('#')[0] + '#';
      if (!map.has(bare)) map.set(bare, box);
    }
  }
  return map;
}

/* ================= the renderer ================= */

/**
 * @param {Uint8Array} bytes  the .pptx
 * @param {{}} [opt]
 * @param {(v:number)=>void} [onProg] 0..1
 * @returns {Promise<{blob:Blob, slides:number, notes:Object}>}
 */
async function toPdf(bytes, opt, onProg){
  opt = opt || {};
  const prog = onProg || function(){};
  const files = await root.Zip.read(bytes);

  if (!files.get('ppt/presentation.xml')){
    throw new Error('This does not look like a PowerPoint file — ppt/presentation.xml is missing.');
  }

  const presDoc = parseXml(files.get('ppt/presentation.xml'));
  const presRels = relsFor(files, 'ppt/presentation.xml');

  /* slide size, in points */
  const sz = find(presDoc, 'p', 'sldSz');
  const SW = num(sz, 'cx', 9144000) / PT;
  const SH = num(sz, 'cy', 6858000) / PT;

  /* slide order comes from sldIdLst, NOT from filename order — a deck that has
     been reordered keeps its original slideN.xml names. */
  const order = [];
  const lst = find(presDoc, 'p', 'sldIdLst');
  for (const s of kids(lst, 'p', 'sldId')){
    const rid = s.getAttributeNS(NS.r, 'id');
    const rel = presRels.get(rid);
    if (rel) order.push(resolvePath('ppt/presentation.xml', rel.target));
  }
  if (!order.length){
    for (const name of files.keys()){
      if (/^ppt\/slides\/slide\d+\.xml$/.test(name)) order.push(name);
    }
    order.sort((a,b) => (+a.match(/(\d+)/)[1]) - (+b.match(/(\d+)/)[1]));
  }
  if (!order.length) throw new Error('No slides found in this presentation.');

  const { PDFDocument, StandardFonts, rgb, degrees } = await root.DocsLib.need.pdflib();
  const pdf = await PDFDocument.create();
  const F = {
    reg : await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    ital: await pdf.embedFont(StandardFonts.HelveticaOblique),
    bi  : await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  const notes = { skipped:0, images:0, badImages:0, tables:0, dropped:{ n:0 } };
  const imgCache = new Map();

  /* ---- memoised parts ---------------------------------------------------
     Nothing below depends on which slide is being drawn, and a deck typically
     has one master and a handful of layouts shared by every slide. */
  const xmlCache = new Map(), relCache = new Map(), chainCache = new Map();
  const xml = name => {
    if (!name) return null;
    if (!xmlCache.has(name)) xmlCache.set(name, parseXml(files.get(name)));
    return xmlCache.get(name);
  };
  const rlsOf = name => {
    if (!relCache.has(name)) relCache.set(name, relsFor(files, name));
    return relCache.get(name);
  };
  const breathe = () => (root.Core && root.Core.idle) ? root.Core.idle() : Promise.resolve();

  function layoutChain(layoutPart){
    const key = layoutPart || '';
    if (chainCache.has(key)) return chainCache.get(key);

    const layoutDoc = xml(layoutPart);
    let masterPart = null;
    if (layoutDoc){
      for (const [, rel] of rlsOf(layoutPart)){
        if (rel.type && rel.type.endsWith('/slideMaster')) masterPart = resolvePath(layoutPart, rel.target);
      }
    }
    const masterDoc = xml(masterPart);

    let theme = {};
    if (masterDoc){
      for (const [, rel] of rlsOf(masterPart)){
        if (rel.type && rel.type.endsWith('/theme')){
          const t = xml(resolvePath(masterPart, rel.target));
          if (t) theme = themeColors(t);
        }
      }
    }
    const out = {
      layoutDoc, layoutPart, masterDoc, masterPart, theme,
      phLayout: placeholderMap(layoutDoc),
      phMaster: placeholderMap(masterDoc),
      txStyles: txStylesOf(masterDoc),
    };
    chainCache.set(key, out);
    return out;
  }

  for (let i = 0; i < order.length; i++){
    const partName = order[i];
    const doc = xml(partName);
    if (!doc){ notes.skipped++; continue; }

    const rels = rlsOf(partName);

    /* Slides share layouts, and every layout shares one master. Resolving this
       chain per slide meant re-parsing the master -- usually the largest part
       in the file -- and rebuilding its placeholder map and text styles once
       per slide. All of it is keyed by part name and computed once. */
    let layoutPart = null;
    for (const [, rel] of rels){
      if (rel.type && rel.type.endsWith('/slideLayout')) layoutPart = resolvePath(partName, rel.target);
    }
    const chain = layoutChain(layoutPart);
    const { layoutDoc, masterDoc, masterPart, theme, phLayout, phMaster, txStyles } = chain;

    const page = pdf.addPage([SW, SH]);
    const base = { pdf, page, rgb, degrees, F, theme, files,
                   phLayout, phMaster, SW, SH, notes, imgCache, txStyles };

    /* Background, most specific first: the slide may override the layout,
       which may override the master. */
    const bg = bgFillOf(doc, theme) || bgFillOf(layoutDoc, theme) || bgFillOf(masterDoc, theme);
    if (bg) page.drawRectangle({ x:0, y:0, width:SW, height:SH, color: rgb(bg.r, bg.g, bg.b) });

    /* THE THREE LAYERS, bottom to top. The master's and layout's own shapes are
       the design furniture -- bands, rules, logos -- and are what makes a deck
       look like itself. Their placeholders are only prototypes and hold prompt
       text, so those are skipped; the slide supplies the real content. */
    const showMaster = attr(doc.documentElement, 'showMasterSp', '1') !== '0';
    const layers = [];
    if (showMaster && masterDoc) layers.push([masterDoc, masterPart]);
    if (showMaster && layoutDoc) layers.push([layoutDoc, layoutPart]);
    layers.push([doc, partName]);

    for (const [part, name] of layers){
      const tree = find(part, 'p', 'spTree');
      if (!tree) continue;
      const ctx = Object.assign({}, base, {
        rels: name === partName ? rels : rlsOf(name),
        partName: name,
        skipPh: name !== partName,      // only the slide's placeholders hold content
      });
      await walk(tree, ctx, { dx:0, dy:0, sx:1, sy:1 });
    }

    prog((i + 1) / order.length);
    // Every slide, not every fourth: a deck of heavy slides would otherwise
    // hold the main thread long enough for the page to stop responding.
    await breathe();
  }

  const out = await pdf.save();
  return {
    blob: new Blob([out], { type:'application/pdf' }),
    slides: order.length,
    width: SW, height: SH,
    notes,
  };
}

/* ================= walking the shape tree ================= */
async function walk(tree, ctx, T){
  for (let n = tree.firstElementChild; n; n = n.nextElementSibling){
    if (n.namespaceURI !== NS.p) continue;
    try {
      if (n.localName === 'sp')            await drawShape(n, ctx, T);
      else if (n.localName === 'pic')      await drawPicture(n, ctx, T);
      else if (n.localName === 'graphicFrame') await drawFrame(n, ctx, T);
      else if (n.localName === 'grpSp')    await drawGroup(n, ctx, T);
      else if (n.localName === 'cxnSp')    await drawShape(n, ctx, T);   // connectors
    } catch (e){
      ctx.notes.skipped++;
    }
  }
}

/** A group carries its own frame plus a child coordinate space to map from. */
async function drawGroup(grp, ctx, T){
  const gp = kid(grp, 'p', 'grpSpPr');
  const x = find(gp, 'a', 'xfrm');
  let inner = T;
  if (x){
    const off = kid(x,'a','off'), ext = kid(x,'a','ext');
    const chOff = kid(x,'a','chOff'), chExt = kid(x,'a','chExt');
    if (off && ext && chOff && chExt){
      const cx = num(chExt,'cx',1) || 1, cy = num(chExt,'cy',1) || 1;
      const sx = (num(ext,'cx',cx) / cx) * T.sx;
      const sy = (num(ext,'cy',cy) / cy) * T.sy;
      inner = {
        sx, sy,
        dx: T.dx + (num(off,'x',0)/PT) * T.sx - (num(chOff,'x',0)/PT) * sx,
        dy: T.dy + (num(off,'y',0)/PT) * T.sy - (num(chOff,'y',0)/PT) * sy,
      };
    }
  }
  await walk(grp, ctx, inner);
}

/** Apply the current group transform, and flip to PDF's bottom-left origin. */
function place(box, ctx, T){
  const x = T.dx + box.x * T.sx;
  const y = T.dy + box.y * T.sy;
  const w = box.w * T.sx;
  const h = box.h * T.sy;
  return { x, w, h, top: y, y: ctx.SH - y - h };
}

/** Where is this shape? Its own xfrm, else the layout's, else the master's. */
function boxFor(sp, ctx){
  const own = xfrmOf(kid(sp, 'p', 'spPr'));
  if (own) return own;
  const key = phKeyOf(sp);
  if (!key) return null;
  const bare = key.split('#')[0] + '#';
  return ctx.phLayout.get(key) || ctx.phMaster.get(key) ||
         ctx.phLayout.get(bare) || ctx.phMaster.get(bare) || null;
}

async function drawShape(sp, ctx, T){
  // On the master and layout, a placeholder is a prototype holding prompt text
  // ("Click to edit Master title style"), never content. Skip those; draw the
  // ordinary shapes, which are the design furniture.
  if (ctx.skipPh && find(sp, 'p', 'ph')) return;

  const spPr = kid(sp, 'p', 'spPr');
  const style = kid(sp, 'p', 'style');
  const box = boxFor(sp, ctx);
  if (!box) return;
  const R = place(box, ctx, T);
  if (R.w <= 0 || R.h <= 0) return;

  /* fill: what the shape states, else what its style reference points at */
  const fill = fillOf(spPr, style, ctx.theme);

  /* outline, same idea */
  const ln = kid(spPr, 'a', 'ln');
  const lnNoFill = ln ? kid(ln, 'a', 'noFill') : null;
  let stroke = (ln && !lnNoFill) ? colorOf(kid(ln, 'a', 'solidFill'), ctx.theme) : null;
  if (!stroke && !lnNoFill && style){
    const lr = kid(style, 'a', 'lnRef');
    if (lr && num(lr, 'idx', 0) > 0) stroke = colorOf(lr, ctx.theme);
  }
  const lw = ln ? Math.max(0.4, num(ln, 'w', 9525) / PT) : 0.75;

  const prst = attr(find(spPr, 'a', 'prstGeom'), 'prst', 'rect');

  if (fill || stroke){
    const common = { x:R.x, y:R.y, width:R.w, height:R.h };
    if (fill)   common.color = ctx.rgb(fill.r, fill.g, fill.b);
    if (stroke){ common.borderColor = ctx.rgb(stroke.r, stroke.g, stroke.b); common.borderWidth = lw; }
    if (/^(ellipse|circle)$/.test(prst)){
      ctx.page.drawEllipse({ x:R.x + R.w/2, y:R.y + R.h/2, xScale:R.w/2, yScale:R.h/2,
        color: common.color, borderColor: common.borderColor, borderWidth: common.borderWidth });
    } else if (/^(line|straightConnector1|bentConnector|curvedConnector)/.test(prst)){
      if (stroke) ctx.page.drawLine({
        start:{ x:R.x, y:R.y + R.h }, end:{ x:R.x + R.w, y:R.y },
        thickness: lw, color: ctx.rgb(stroke.r, stroke.g, stroke.b) });
    } else {
      ctx.page.drawRectangle(common);
    }
  }

  const tx = kid(sp, 'p', 'txBody');
  if (tx) drawText(tx, R, ctx, sp, null, style);
}

async function drawPicture(pic, ctx, T){
  const box = xfrmOf(kid(pic, 'p', 'spPr'));
  if (!box) return;
  const R = place(box, ctx, T);
  if (R.w <= 0 || R.h <= 0) return;

  const blip = find(pic, 'a', 'blip');
  const rid = blip && blip.getAttributeNS(NS.r, 'embed');
  if (!rid) return;
  const rel = ctx.rels.get(rid);
  if (!rel) return;
  const path = resolvePath(ctx.partName, rel.target);
  const data = ctx.files.get(path);
  if (!data){ ctx.notes.badImages++; return; }

  let img = ctx.imgCache.get(path);
  if (img === undefined){
    // Embedding is the single slowest thing here -- a large PNG has to be
    // decoded and re-encoded -- so let the page breathe before each new one.
    if (root.Core && root.Core.idle) await root.Core.idle();
    img = null;
    try {
      // sniff the bytes, not the extension: decks routinely mislabel these
      if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47){
        img = await ctx.pdf.embedPng(data);
      } else if (data[0] === 0xFF && data[1] === 0xD8){
        img = await ctx.pdf.embedJpg(data);
      }
    } catch (_){ img = null; }
    ctx.imgCache.set(path, img);
  }
  if (!img){ ctx.notes.badImages++; return; }   // gif / bmp / emf / wmf / svg

  ctx.page.drawImage(img, { x:R.x, y:R.y, width:R.w, height:R.h });
  ctx.notes.images++;
}

/** Tables arrive as a graphicFrame wrapping <a:tbl>. */
async function drawFrame(fr, ctx, T){
  const xf = find(fr, 'p', 'xfrm') || find(fr, 'a', 'xfrm');
  const off = kid(xf, 'a', 'off'), ext = kid(xf, 'a', 'ext');
  if (!off || !ext) { ctx.notes.skipped++; return; }
  const box = { x:num(off,'x',0)/PT, y:num(off,'y',0)/PT,
                w:num(ext,'cx',0)/PT, h:num(ext,'cy',0)/PT };
  const R = place(box, ctx, T);

  const tbl = find(fr, 'a', 'tbl');
  if (!tbl){ ctx.notes.skipped++; return; }      // chart, SmartArt, OLE object
  ctx.notes.tables++;

  const grid = find(tbl, 'a', 'tblGrid');
  const colW = kids(grid, 'a', 'gridCol').map(c => num(c, 'w', 0) / PT * T.sx);
  const totalW = colW.reduce((a,b) => a+b, 0) || R.w;
  const scale = R.w / totalW;

  let y = R.top;
  for (const tr of kids(tbl, 'a', 'tr')){
    const rowH = num(tr, 'h', 0) / PT * T.sy;
    let x = R.x, ci = 0;
    for (const tc of kids(tr, 'a', 'tc')){
      const w = (colW[ci] || (R.w / Math.max(1, colW.length))) * scale;
      const cellFill = colorOf(kid(kid(tc, 'a', 'tcPr'), 'a', 'solidFill'), ctx.theme);
      const cy = ctx.SH - y - rowH;
      if (cellFill){
        ctx.page.drawRectangle({ x, y:cy, width:w, height:rowH,
          color: ctx.rgb(cellFill.r, cellFill.g, cellFill.b) });
      }
      ctx.page.drawRectangle({ x, y:cy, width:w, height:rowH,
        borderColor: ctx.rgb(.72,.72,.72), borderWidth:0.5 });
      const tx = kid(tc, 'a', 'txBody');
      if (tx) drawText(tx, { x:x+3, y:cy, w:w-6, h:rowH, top:y }, ctx, null, 9, null);
      x += w; ci++;
    }
    y += rowH;
  }
}

/* ================= text ================= */

/* What a run should look like when it states nothing itself. Most efficient
   source first: the shape's own list style, then the layout placeholder's,
   then the master's txStyles for that family, then a plain fallback. */
function inherited(ctx, sp, lvl, style){
  const out = { size: 18, bold: false, ital: false, col: null, align: null };
  if (!sp) { out.size = 12; return out; }

  const fam = styleFamily(sp);
  const m = ctx.txStyles && ctx.txStyles[fam] && ctx.txStyles[fam][lvl];
  if (m){
    if (m.size) out.size = m.size;
    out.bold = m.bold; out.ital = m.ital; out.align = m.align;
    if (m.colNode) out.col = colorOf(m.colNode, ctx.theme);
  } else {
    const ph = find(sp, 'p', 'ph');
    const t = ph ? attr(ph, 'type', 'body') : '';
    out.size = (t === 'title' || t === 'ctrTitle') ? 36 : (t === 'subTitle') ? 20 : 18;
  }

  /* the shape's own list style, if it carries one, wins over the master */
  const lst = lstStyleOf(sp);
  if (lst){
    const lvlPr = kid(lst, 'a', 'lvl' + (lvl + 1) + 'pPr');
    const def = lvlPr ? kid(lvlPr, 'a', 'defRPr') : null;
    if (def){
      if (def.hasAttribute('sz')) out.size = num(def, 'sz', out.size * 100) / 100;
      if (def.hasAttribute('b')) out.bold = attr(def, 'b') === '1';
      const c = colorOf(kid(def, 'a', 'solidFill'), ctx.theme);
      if (c) out.col = c;
    }
    if (lvlPr && lvlPr.hasAttribute('algn')) out.align = attr(lvlPr, 'algn');
  }

  /* a shape style's fontRef is the last word on colour before the theme */
  if (!out.col && style){
    const fr = kid(style, 'a', 'fontRef');
    if (fr){
      const c = colorOf(fr, ctx.theme);
      if (c) out.col = c;
    }
  }
  if (!out.col) out.col = { r: 0, g: 0, b: 0 };
  return out;
}

function drawText(txBody, R, ctx, sp, forceSize, style){
  const bodyPr = kid(txBody, 'a', 'bodyPr');
  const anchor = attr(bodyPr, 'anchor', 't');            // t | ctr | b
  const insL = num(bodyPr, 'lIns', 91440) / PT;
  const insR = num(bodyPr, 'rIns', 91440) / PT;
  const insT = num(bodyPr, 'tIns', 45720) / PT;
  const insB = num(bodyPr, 'bIns', 45720) / PT;

  const boxX = R.x + insL;
  const boxW = Math.max(6, R.w - insL - insR);
  const boxTop = R.top + insT;
  const boxH = Math.max(6, R.h - insT - insB);

  const lines = [];

  for (const p of kids(txBody, 'a', 'p')){
    const pPr = kid(p, 'a', 'pPr');
    const lvl = Math.min(8, parseInt(attr(pPr, 'lvl', '0'), 10) || 0);
    const inh = forceSize
      ? { size: forceSize, bold: false, ital: false, col: { r:0, g:0, b:0 }, align: null }
      : inherited(ctx, sp, lvl, style);
    const base = inh.size;
    const align = attr(pPr, 'algn', inh.align || 'l');
    const buChar = kid(pPr, 'a', 'buChar');
    const buNone = kid(pPr, 'a', 'buNone');
    const indent = lvl * 16;

    /* gather runs; <a:br/> forces a new line */
    let segs = [];
    const flush = () => { pushWrapped(lines, segs, boxW - indent, align, indent, ctx); segs = []; };

    for (let n = p.firstElementChild; n; n = n.nextElementSibling){
      if (n.namespaceURI !== NS.a) continue;
      if (n.localName === 'br'){ flush(); continue; }
      if (n.localName !== 'r' && n.localName !== 'fld') continue;
      const rPr = kid(n, 'a', 'rPr');
      const t = kid(n, 'a', 't');
      const raw = t ? t.textContent : '';
      if (!raw) continue;
      const size = rPr && rPr.hasAttribute('sz') ? num(rPr, 'sz', base*100) / 100 : base;
      const bold = rPr && rPr.hasAttribute('b') ? attr(rPr, 'b') === '1' : inh.bold;
      const ital = rPr && rPr.hasAttribute('i') ? attr(rPr, 'i') === '1' : inh.ital;
      const col  = colorOf(kid(rPr, 'a', 'solidFill'), ctx.theme) || inh.col;
      segs.push({ text: toWinAnsi(raw, ctx.notes.dropped), size, bold, ital, col });
    }

    if (segs.length && buChar && !buNone){
      const b = toWinAnsi(attr(buChar, 'char', '•'), ctx.notes.dropped) || '-';
      segs.unshift({ text: b + '  ', size: segs[0].size, bold:false, ital:false, col: segs[0].col });
    }
    if (segs.length) flush();
    else lines.push({ segs: [], height: base * 1.2, align, indent });   // blank line
    void 0;
  }

  if (!lines.length) return;

  const totalH = lines.reduce((a, l) => a + l.height, 0);
  let y = boxTop;
  if (anchor === 'ctr') y = boxTop + Math.max(0, (boxH - totalH) / 2);
  else if (anchor === 'b') y = boxTop + Math.max(0, boxH - totalH);

  for (const line of lines){
    const w = line.segs.reduce((a, s) => a + fontOf(ctx.F, s).widthOfTextAtSize(s.text, s.size), 0);
    let x = boxX + line.indent;
    if (line.align === 'ctr') x = boxX + line.indent + Math.max(0, (boxW - line.indent - w) / 2);
    else if (line.align === 'r') x = boxX + Math.max(0, boxW - w);

    const baseline = ctx.SH - y - line.height * 0.82;
    for (const s of line.segs){
      if (!s.text) continue;
      try {
        ctx.page.drawText(s.text, { x, y: baseline, size: s.size,
          font: fontOf(ctx.F, s), color: ctx.rgb(s.col.r, s.col.g, s.col.b) });
      } catch (_){ ctx.notes.skipped++; }
      x += fontOf(ctx.F, s).widthOfTextAtSize(s.text, s.size);
    }
    y += line.height;
  }
}

const fontOf = (F, s) => s.bold && s.ital ? F.bi : s.bold ? F.bold : s.ital ? F.ital : F.reg;

/** Break a run sequence into lines that fit the box, keeping run styling. */
function pushWrapped(lines, segs, width, align, indent, ctx){
  if (!segs.length) return;
  let cur = [], curW = 0;
  const height = () => Math.max(...(cur.length ? cur : segs).map(s => s.size)) * 1.22;

  for (const seg of segs){
    const font = fontOf(ctx.F, seg);
    // keep the spaces: split on word boundaries but retain them for width
    const words = seg.text.split(/(\s+)/).filter(w => w !== '');
    let buf = '';
    for (const w of words){
      const test = buf + w;
      const tw = font.widthOfTextAtSize(test, seg.size);
      if (curW + tw > width && (buf || cur.length)){
        if (buf) cur.push({ ...seg, text: buf });
        lines.push({ segs: cur, height: height(), align, indent });
        cur = []; curW = 0;
        buf = /^\s+$/.test(w) ? '' : w;             // a wrap eats the space
      } else {
        buf = test;
      }
    }
    if (buf){ cur.push({ ...seg, text: buf }); curW += font.widthOfTextAtSize(buf, seg.size); }
  }
  if (cur.length) lines.push({ segs: cur, height: height(), align, indent });
}

/* ================= a cheap look inside, for the UI ================= */
async function probe(bytes){
  const files = await root.Zip.read(bytes);
  const presDoc = parseXml(files.get('ppt/presentation.xml'));
  if (!presDoc) throw new Error('Not a PowerPoint file.');
  const sz = find(presDoc, 'p', 'sldSz');
  let slides = 0, media = 0;
  for (const name of files.keys()){
    if (/^ppt\/slides\/slide\d+\.xml$/.test(name)) slides++;
    if (/^ppt\/media\//.test(name)) media++;
  }
  const w = num(sz, 'cx', 9144000) / PT, h = num(sz, 'cy', 6858000) / PT;
  const counts = scanSlides(files);
  return { slides, media, width:w, height:h,
           ratio: (w/h > 1.5) ? '16:9' : (Math.abs(w/h - 4/3) < 0.05 ? '4:3' : (w/h).toFixed(2)+':1'),
           charts: counts.charts, smartArt: counts.smartArt };
}

/* One pass, decoding each slide once. It used to decode every slide twice --
   once looking for charts and again for SmartArt -- which on a large deck is
   several megabytes of needless UTF-8 decoding. */
function scanSlides(files){
  let charts = 0, smartArt = 0;
  for (const [name, data] of files){
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(name)) continue;
    const s = dec.decode(data);
    if (/<c:chart|graphicData[^>]*chart/.test(s)) charts++;
    if (/diagramData|smartArt/.test(s)) smartArt++;
  }
  return { charts, smartArt };
}

const isPptx = f => /\.pptx$/i.test(f.name || String(f));
const isLegacyPpt = f => /\.ppt$/i.test(f.name || String(f));

root.Pptx = { toPdf, probe, isPptx, isLegacyPpt };

})(typeof self !== 'undefined' ? self : this);
