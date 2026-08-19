/* docx.js — build, read and merge Word .docx files with no dependencies.
 *
 * A .docx is a ZIP holding OOXML parts. The three that matter here:
 *   word/document.xml            the content
 *   word/_rels/document.xml.rels relationship ids -> images, styles, links
 *   [Content_Types].xml          MIME type per part/extension
 *
 * Written against ECMA-376. Word is strict about part order and namespaces, so
 * the boilerplate below is deliberate rather than decorative.
 */
(function (root) {
'use strict';

const Zip = root.Zip || (typeof require === 'function' ? require('./zip.js') : null);

const NS = {
  w  : 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r  : 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  wp : 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a  : 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
};
const REL = {
  doc  : 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  style: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
  num  : 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering',
  image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
};

const EMU_PER_PT = 12700;          // English Metric Units
const TWIP_PER_PT = 20;
const PAGE = { A4:{ w:11906, h:16838 }, LETTER:{ w:12240, h:15840 } };

/* ---------- XML helpers ---------- */
function esc(s){
  return String(s == null ? '' : s)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')   // control chars are illegal in XML 1.0
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}
const XMLDECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

/* ================= BUILD ================= */
/**
 * @param {object} o
 *   blocks   array of {type:'p'|'image'|'pagebreak', ...}
 *   page     {w,h} in twips (default A4), margin in twips
 *   title    document title
 * @returns {Promise<Blob>} a .docx
 */
async function build(o){
  o = o || {};
  const page = o.page || PAGE.A4;
  const margin = o.margin == null ? 1440 : o.margin;   // 1 inch
  const blocks = o.blocks || [];

  const media = [];        // {name, data, rid}
  let ridSeq = 10;
  const body = [];
  let docPrId = 1;

  // Anchored pictures must live inside a paragraph on the page they belong to.
  // They are held here and folded into the next real paragraph, rather than
  // getting a paragraph of their own -- an extra empty one would push the text
  // down and undo the positioning we are trying to preserve.
  let anchored = [];
  const flushAnchors = () => {
    if (!anchored.length) return;
    body.push('<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="1" w:lineRule="exact"/>' +
              '</w:pPr>' + anchored.join('') + '</w:p>');
    anchored = [];
  };

  for (const b of blocks){
    if (!b) continue;

    if (b.type === 'pagebreak'){
      flushAnchors();                       // anchors belong to the page we are leaving
      body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
      continue;
    }

    if (b.type === 'table' && b.rows && b.rows.length){
      flushAnchors();
      const cols = Math.max(...b.rows.map(r => r.length));
      const colW = Math.floor((page.w - margin*2) / cols);
      const border = ['top','left','bottom','right','insideH','insideV']
        .map(s => '<w:' + s + ' w:val="single" w:sz="4" w:space="0" w:color="9AA4B2"/>').join('');
      body.push(
        '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>' + border + '</w:tblBorders></w:tblPr>' +
        '<w:tblGrid>' + Array(cols).fill('<w:gridCol w:w="' + colW + '"/>').join('') + '</w:tblGrid>' +
        b.rows.map((row, ri) =>
          '<w:tr>' + Array.from({ length: cols }, (_, ci) => {
            const cell = row[ci] == null ? '' : String(row[ci]);
            const strong = b.headerRow && ri === 0;
            return '<w:tc><w:tcPr><w:tcW w:w="' + colW + '" w:type="dxa"/></w:tcPr>' +
                   '<w:p><w:r>' + (strong ? '<w:rPr><w:b/></w:rPr>' : '') +
                   '<w:t xml:space="preserve">' + esc(cell) + '</w:t></w:r></w:p></w:tc>';
          }).join('') + '</w:tr>').join('') +
        '</w:tbl><w:p/>');    // Word requires a paragraph after a table
      continue;
    }

    if (b.type === 'image' && b.data){
      const ext = (b.ext || 'png').toLowerCase();
      const rid = 'rId' + (++ridSeq);
      const name = 'image' + media.length + '.' + ext;
      media.push({ name, data:b.data, rid, ext });

      const cx = Math.round((b.widthPt  || 400) * EMU_PER_PT);
      const cy = Math.round((b.heightPt || 300) * EMU_PER_PT);
      const id = docPrId++;

      const graphic =
        '<wp:docPr id="' + id + '" name="Picture ' + id + '"/>' +
        '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
        '<a:graphic><a:graphicData uri="' + NS.pic + '"><pic:pic>' +
        '<pic:nvPicPr><pic:cNvPr id="' + id + '" name="' + esc(name) + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
        '<pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
        '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
        '</pic:pic></a:graphicData></a:graphic>';

      if (b.anchor){
        // Pinned to an exact spot on the page, which is the only way to keep a
        // PDF's absolute layout: Word flows inline images, anchored ones stay put.
        anchored.push(
          '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
          'relativeHeight="' + (1000 + id) + '" behindDoc="' + (b.behind ? '1' : '0') +
          '" locked="0" layoutInCell="1" allowOverlap="1">' +
          '<wp:simplePos x="0" y="0"/>' +
          '<wp:positionH relativeFrom="page"><wp:posOffset>' +
            Math.max(0, Math.round(b.anchor.xPt * EMU_PER_PT)) + '</wp:posOffset></wp:positionH>' +
          '<wp:positionV relativeFrom="page"><wp:posOffset>' +
            Math.max(0, Math.round(b.anchor.yPt * EMU_PER_PT)) + '</wp:posOffset></wp:positionV>' +
          '<wp:extent cx="' + cx + '" cy="' + cy + '"/>' +
          '<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>' +
          graphic + '</wp:anchor></w:drawing></w:r>');
        continue;
      }

      body.push(
        '<w:p>' + (b.align ? '<w:pPr><w:jc w:val="' + b.align + '"/></w:pPr>' : '') +
        '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
        '<wp:extent cx="' + cx + '" cy="' + cy + '"/>' +
        '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
        graphic + '</wp:inline></w:drawing></w:r></w:p>');
      continue;
    }

    // paragraph
    const pPr = [];
    if (b.style)   pPr.push('<w:pStyle w:val="' + esc(b.style) + '"/>');
    if (b.align)   pPr.push('<w:jc w:val="' + esc(b.align) + '"/>');
    const sp = [];
    if (b.spaceBefore) sp.push('w:before="' + Math.round(b.spaceBefore * TWIP_PER_PT) + '"');
    if (b.spaceAfter != null) sp.push('w:after="' + Math.round(b.spaceAfter * TWIP_PER_PT) + '"');
    if (b.lineRule) sp.push('w:line="' + Math.round(b.lineRule * TWIP_PER_PT) + '" w:lineRule="auto"');
    if (sp.length) pPr.push('<w:spacing ' + sp.join(' ') + '/>');
    if (b.indent)  pPr.push('<w:ind w:left="' + Math.round(b.indent * TWIP_PER_PT) + '"/>');

    const runs = (b.runs || []).map(r => {
      const rPr = [];
      if (r.font)   rPr.push('<w:rFonts w:ascii="' + esc(r.font) + '" w:hAnsi="' + esc(r.font) + '" w:cs="' + esc(r.font) + '"/>');
      if (r.bold)   rPr.push('<w:b/>');
      if (r.italic) rPr.push('<w:i/>');
      if (r.size)   rPr.push('<w:sz w:val="' + Math.round(r.size * 2) + '"/><w:szCs w:val="' + Math.round(r.size * 2) + '"/>');
      if (r.color)  rPr.push('<w:color w:val="' + esc(r.color) + '"/>');
      const text = String(r.text == null ? '' : r.text);
      return '<w:r>' + (rPr.length ? '<w:rPr>' + rPr.join('') + '</w:rPr>' : '') +
             '<w:t xml:space="preserve">' + esc(text) + '</w:t></w:r>';
    }).join('');

    const anchorRuns = anchored.join('');
    anchored = [];
    body.push('<w:p>' + (pPr.length ? '<w:pPr>' + pPr.join('') + '</w:pPr>' : '') +
              anchorRuns + runs + '</w:p>');
  }
  flushAnchors();

  const sectPr =
    '<w:sectPr><w:pgSz w:w="' + page.w + '" w:h="' + page.h + '"/>' +
    '<w:pgMar w:top="' + margin + '" w:right="' + margin + '" w:bottom="' + margin +
    '" w:left="' + margin + '" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';

  const documentXml = XMLDECL +
    '<w:document xmlns:w="' + NS.w + '" xmlns:r="' + NS.r + '" xmlns:wp="' + NS.wp +
    '" xmlns:a="' + NS.a + '" xmlns:pic="' + NS.pic + '">' +
    '<w:body>' + body.join('') + sectPr + '</w:body></w:document>';

  const rels = XMLDECL +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="' + REL.style + '" Target="styles.xml"/>' +
    media.map(m => '<Relationship Id="' + m.rid + '" Type="' + REL.image +
                   '" Target="media/' + m.name + '"/>').join('') +
    '</Relationships>';

  const exts = new Set(['rels','xml', ...media.map(m => m.ext)]);
  const contentTypes = XMLDECL +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    [...exts].map(e => '<Default Extension="' + e + '" ContentType="' + mimeForExt(e) + '"/>').join('') +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '</Types>';

  const entries = [
    { name:'[Content_Types].xml', data: contentTypes },
    { name:'_rels/.rels', data: XMLDECL +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="' + REL.doc + '" Target="word/document.xml"/></Relationships>' },
    { name:'word/document.xml', data: documentXml },
    { name:'word/_rels/document.xml.rels', data: rels },
    { name:'word/styles.xml', data: stylesXml(o.baseFont, o.baseSize) },
  ];
  for (const m of media) entries.push({ name:'word/media/' + m.name, data:m.data });

  return Zip.write(entries, {
    mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  });
}

function mimeForExt(e){
  return e === 'rels' ? 'application/vnd.openxmlformats-package.relationships+xml'
       : e === 'xml'  ? 'application/xml'
       : e === 'png'  ? 'image/png'
       : e === 'gif'  ? 'image/gif'
       : e === 'bmp'  ? 'image/bmp'
       : 'image/jpeg';
}

function stylesXml(font, size){
  font = font || 'Calibri';
  size = (size || 11) * 2;
  const heading = (id, name, sz, outline) =>
    '<w:style w:type="paragraph" w:styleId="' + id + '"><w:name w:val="' + name + '"/>' +
    '<w:basedOn w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:keepNext/><w:outlineLvl w:val="' + outline + '"/>' +
    '<w:spacing w:before="240" w:after="120"/></w:pPr>' +
    '<w:rPr><w:b/><w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/></w:rPr></w:style>';
  return XMLDECL +
    '<w:styles xmlns:w="' + NS.w + '">' +
    '<w:docDefaults><w:rPrDefault><w:rPr>' +
    '<w:rFonts w:ascii="' + esc(font) + '" w:hAnsi="' + esc(font) + '"/>' +
    '<w:sz w:val="' + size + '"/><w:szCs w:val="' + size + '"/>' +
    '</w:rPr></w:rPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    heading('Heading1','heading 1',32,'0') +
    heading('Heading2','heading 2',26,'1') +
    heading('Heading3','heading 3',24,'2') +
    '</w:styles>';
}

/* ================= READ ================= */
async function read(input){
  const files = await Zip.read(input);
  const dec = new TextDecoder();
  const text = n => files.has(n) ? dec.decode(files.get(n)) : null;
  const doc = text('word/document.xml');
  if (!doc) throw new Error('This is not a Word .docx file (no word/document.xml inside).');
  return {
    files,
    documentXml: doc,
    relsXml    : text('word/_rels/document.xml.rels') || '',
    stylesXml  : text('word/styles.xml') || '',
    numberingXml: text('word/numbering.xml') || '',
    contentTypes: text('[Content_Types].xml') || '',
  };
}

/** Plain text of a document — handy for previews and for sanity checks. */
function plainText(documentXml){
  return documentXml
    .replace(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g, m =>
      (m.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [])
        .map(t => t.replace(/<[^>]+>/g,'')).join('') + '\n')
    .replace(/<[^>]+>/g,'')
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&amp;/g,'&');
}

/* ================= MERGE ================= */
/**
 * Concatenate several .docx files into one, page-breaking between them.
 *
 * The first document sets the page size, styles and defaults. Later documents
 * contribute their content, their images, and any style or numbering
 * definitions whose ids the first document did not already use.
 *
 * @param {Array<{name:string, bytes:Uint8Array}>} docs
 * @param {{pageBreaks?:boolean, onProgress?:function}} [opt]
 */
async function merge(docs, opt){
  opt = opt || {};
  const pageBreaks = opt.pageBreaks !== false;
  if (!docs.length) throw new Error('No documents to merge.');

  const first = await read(docs[0].bytes);
  const out = new Map(first.files);            // start from a full copy of doc 1

  let bodyParts = [ bodyInner(first.documentXml) ];
  const sectPr = (first.documentXml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>|<w:sectPr[^>]*\/>/g) || []).pop() || '';

  // ids already spoken for, so later documents can be shifted clear of them
  let ridSeq = 5000;
  let mediaSeq = 0;
  let numShift = 0;
  const styleIds = new Set([...first.stylesXml.matchAll(/w:styleId="([^"]+)"/g)].map(m => m[1]));
  let stylesXmlOut = first.stylesXml;
  let numberingXmlOut = first.numberingXml;
  numShift = maxNumId(first.numberingXml);

  for (let i = 1; i < docs.length; i++){
    const d = await read(docs[i].bytes);
    let xml = bodyInner(d.documentXml);

    /* --- images: copy the files under fresh names, remap the ids --- */
    const relMap = new Map();
    for (const m of d.relsXml.matchAll(/<Relationship\b[^>]*\/>/g)){
      const tag = m[0];
      const id     = (tag.match(/Id="([^"]+)"/) || [])[1];
      const type   = (tag.match(/Type="([^"]+)"/) || [])[1];
      const target = (tag.match(/Target="([^"]+)"/) || [])[1];
      if (!id || type !== REL.image || !target) continue;

      const src = 'word/' + target.replace(/^\.?\//,'');
      if (!d.files.has(src)) continue;
      const ext = (target.match(/\.([^.]+)$/) || [,'png'])[1].toLowerCase();
      const newName = 'merged' + (mediaSeq++) + '.' + ext;
      const newId = 'rIdM' + (ridSeq++);
      out.set('word/media/' + newName, d.files.get(src));
      relMap.set(id, { newId, newName, ext });
    }

    // rewrite only genuine relationship attributes — a blind string replace
    // would corrupt "rId1" vs "rId10"
    if (relMap.size){
      xml = xml.replace(/(r:(?:embed|id|link)=")([^"]+)(")/g, (all, a, id, b) => {
        const hit = relMap.get(id);
        return hit ? a + hit.newId + b : all;
      });
      const adds = [...relMap.values()].map(v =>
        '<Relationship Id="' + v.newId + '" Type="' + REL.image + '" Target="media/' + v.newName + '"/>').join('');
      const baseRels = new TextDecoder().decode(out.get('word/_rels/document.xml.rels'));
      out.set('word/_rels/document.xml.rels',
        new TextEncoder().encode(baseRels.replace('</Relationships>', adds + '</Relationships>')));
    }

    /* --- list numbering: shift this document's ids clear of the previous ones --- */
    if (d.numberingXml){
      const shift = numShift;
      const shifted = d.numberingXml
        .replace(/(<w:num\b[^>]*w:numId=")(\d+)(")/g, (a,p,n,s) => p + (+n + shift) + s)
        .replace(/(<w:abstractNum\b[^>]*w:abstractNumId=")(\d+)(")/g, (a,p,n,s) => p + (+n + shift) + s)
        .replace(/(<w:abstractNumId\s+w:val=")(\d+)(")/g, (a,p,n,s) => p + (+n + shift) + s);
      xml = xml.replace(/(<w:numId\s+w:val=")(\d+)(")/g, (a,p,n,s) => p + (+n + shift) + s);

      const inner = (shifted.match(/<w:numbering[^>]*>([\s\S]*)<\/w:numbering>/) || [,''])[1];
      if (!numberingXmlOut){
        numberingXmlOut = shifted;
      } else {
        numberingXmlOut = numberingXmlOut.replace(/<\/w:numbering>/, inner + '</w:numbering>');
      }
      numShift += maxNumId(d.numberingXml) + 1;
    }

    /* --- styles the base document does not already define --- */
    for (const m of d.stylesXml.matchAll(/<w:style\b[\s\S]*?<\/w:style>/g)){
      const id = (m[0].match(/w:styleId="([^"]+)"/) || [])[1];
      if (!id || styleIds.has(id)) continue;
      styleIds.add(id);
      stylesXmlOut = stylesXmlOut.replace(/<\/w:styles>/, m[0] + '</w:styles>');
    }

    if (pageBreaks) bodyParts.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    bodyParts.push(xml);
    if (opt.onProgress) opt.onProgress((i+1) / docs.length);
  }

  const enc = new TextEncoder();
  const header = (first.documentXml.match(/^[\s\S]*?<w:body[^>]*>/) || [''])[0]
              || XMLDECL + '<w:document xmlns:w="' + NS.w + '" xmlns:r="' + NS.r + '"><w:body>';
  out.set('word/document.xml', enc.encode(header + bodyParts.join('') + sectPr + '</w:body></w:document>'));
  if (stylesXmlOut) out.set('word/styles.xml', enc.encode(stylesXmlOut));
  if (numberingXmlOut){
    out.set('word/numbering.xml', enc.encode(numberingXmlOut));
    ensureNumberingWired(out);
  }

  // [Content_Types].xml must declare every image extension now present
  const ctKey = '[Content_Types].xml';
  let ct = new TextDecoder().decode(out.get(ctKey));
  for (const name of out.keys()){
    if (!name.startsWith('word/media/')) continue;
    const ext = (name.match(/\.([^.]+)$/) || [,''])[1].toLowerCase();
    if (ext && !new RegExp('Extension="' + ext + '"', 'i').test(ct))
      ct = ct.replace(/<Types([^>]*)>/, '<Types$1><Default Extension="' + ext +
                      '" ContentType="' + mimeForExt(ext) + '"/>');
  }
  out.set(ctKey, enc.encode(ct));

  return Zip.write(out, {
    mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  });
}

function bodyInner(documentXml){
  const m = documentXml.match(/<w:body[^>]*>([\s\S]*)<\/w:body>/);
  let inner = m ? m[1] : '';
  return inner.replace(/<w:sectPr[\s\S]*?<\/w:sectPr>/g, '').replace(/<w:sectPr[^>]*\/>/g, '');
}

function maxNumId(numberingXml){
  if (!numberingXml) return 0;
  let max = 0;
  for (const m of numberingXml.matchAll(/w:(?:num|abstractNum)Id="(\d+)"/g)) max = Math.max(max, +m[1]);
  return max;
}

/** Make sure numbering.xml is declared and related, or Word ignores the lists. */
function ensureNumberingWired(out){
  const dec = new TextDecoder(), enc = new TextEncoder();
  const relsKey = 'word/_rels/document.xml.rels';
  let rels = dec.decode(out.get(relsKey));
  if (!rels.includes('numbering.xml')){
    rels = rels.replace('</Relationships>',
      '<Relationship Id="rIdNum1" Type="' + REL.num + '" Target="numbering.xml"/></Relationships>');
    out.set(relsKey, enc.encode(rels));
  }
  let ct = dec.decode(out.get('[Content_Types].xml'));
  if (!ct.includes('/word/numbering.xml')){
    ct = ct.replace('</Types>',
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>');
    out.set('[Content_Types].xml', enc.encode(ct));
  }
}

const API = { build, read, merge, plainText, PAGE, EMU_PER_PT, TWIP_PER_PT, esc };
if (typeof module === 'object' && module.exports) module.exports = API;
else root.Docx = API;

})(typeof self !== 'undefined' ? self : this);
