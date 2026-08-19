/* doctools.js — controllers for the three document tools. */
(function () {
'use strict';

const C = window.Core, Docx = window.Docx, L = window.DocsLib;
const { el, fmtBytes, escapeHtml, baseName, download, makePicker, buildZip, crc32, idle } = C;

/* per-panel helper (same shape as the media tools use) */
function P(id){
  const root = document.getElementById('panel-' + id);
  const q = s => root.querySelector('[data-el=' + s + ']');
  const job = q('job');
  const api = {
    root, q,
    step(w){ ['body','job','done'].forEach(k => { const n = q(k); if (n) n.classList.toggle('hide', k !== w); }); },
    prog(v){ const f = job && job.querySelector('.bar > i'); if (f) f.style.width = (v*100).toFixed(1) + '%'; },
    stat(t){ const n = job && job.querySelector('[data-el=stat]'); if (n) n.textContent = t; },
    fail(msg){
      api.step('body');
      let n = root.querySelector('[data-el=err]');
      if (!n){ n = el('div','note err'); n.dataset.el = 'err'; q('body').appendChild(n); }
      n.classList.remove('hide');
      n.innerHTML = '<b>Something went wrong.</b><br>' + escapeHtml(msg).replace(/\n/g,'<br>');
      n.scrollIntoView({ behavior:'smooth', block:'center' });
    },
    clearErr(){ const n = root.querySelector('[data-el=err]'); if (n) n.classList.add('hide'); },
  };
  return api;
}

const bytesOf = async f => new Uint8Array(await f.arrayBuffer());

/* ================= 7. MERGE INTO ONE PDF ================= */
(function toolMergePdf(){
  const p = P('mergepdf');
  let files = [], outBlob = null;

  makePicker(p.q('pick'), {
    kind:'docs', multiple:true, icon:'📄',
    label:'Drag &amp; drop any number of files',
    sub:'PDFs, images (JPG/PNG), Word .docx and .txt — mix them freely',
    onFiles: fs => { files = files.concat(fs); redraw(); }
  });

  function redraw(){
    L.fileList(p.q('list'), files, redraw);
    p.q('body').classList.toggle('hide', !files.length);
    const n = files.length;
    p.q('count').textContent = n ? n + ' file' + (n>1?'s':'') + ' — they merge in the order shown' : '';
    p.q('go').disabled = !n;
  }
  redraw();

  p.q('clear').onclick = () => { files = []; redraw(); };
  p.q('again').onclick = () => { p.step('body'); };
  p.q('save').onclick  = () => download(outBlob, 'merged.pdf');

  p.q('go').onclick = async () => {
    p.clearErr(); p.step('job'); p.prog(0);
    try {
      const { PDFDocument } = await L.need.pdflib();
      const out = await PDFDocument.create();
      let droppedChars = 0, skipped = [];

      for (let i = 0; i < files.length; i++){
        const f = files[i];
        p.stat('Adding ' + f.name + ' (' + (i+1) + ' of ' + files.length + ')…');
        await idle();
        const bytes = await bytesOf(f);

        try {
          if (L.isPdf(f)){
            const src = await PDFDocument.load(bytes, { ignoreEncryption:true });
            const pages = await out.copyPages(src, src.getPageIndices());
            pages.forEach(pg => out.addPage(pg));

          } else if (L.isImg(f)){
            const ext = L.extOf(f.name);
            let img;
            if (ext === 'png') img = await out.embedPng(bytes);
            else if (/jpe?g/.test(ext)) img = await out.embedJpg(bytes);
            else {                                   // re-encode gif/bmp/webp via canvas
              const bmp = await createImageBitmap(new Blob([bytes]));
              const cv = document.createElement('canvas');
              cv.width = bmp.width; cv.height = bmp.height;
              cv.getContext('2d').drawImage(bmp, 0, 0);
              const jpg = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.92));
              img = await out.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
            }
            if (p.q('imgfit').value === 'page'){
              const W = 595.28, H = 841.89, M = 28;
              const pg = out.addPage([W,H]);
              const sc = Math.min((W-M*2)/img.width, (H-M*2)/img.height);
              const w = img.width*sc, h = img.height*sc;
              pg.drawImage(img, { x:(W-w)/2, y:(H-h)/2, width:w, height:h });
            } else {
              const pg = out.addPage([img.width, img.height]);
              pg.drawImage(img, { x:0, y:0, width:img.width, height:img.height });
            }

          } else if (L.isDocx(f)){
            const mammoth = await L.need.mammoth();
            const { value:html } = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
            const r = await L.blocksToPdf(L.htmlToBlocks(html), { into: out });
            droppedChars += r.dropped;

          } else if (L.isTxt(f)){
            const text = new TextDecoder().decode(bytes);
            const blocks = text.split(/\r?\n/).map(line => ({ text:line, size:11, spaceAfter:2 }));
            const r = await L.blocksToPdf(blocks, { into: out });
            droppedChars += r.dropped;

          } else {
            skipped.push(f.name);
          }
        } catch(e){
          skipped.push(f.name + ' (' + e.message + ')');
        }
        p.prog((i+1)/files.length);
      }

      if (out.getPageCount() === 0) throw new Error('None of those files produced any pages.');

      p.stat('Writing the PDF…');
      await idle();
      outBlob = new Blob([await out.save()], { type:'application/pdf' });

      p.step('done');
      p.q('msg').innerHTML = '✅ Merged <b>' + (files.length - skipped.length) + '</b> file' +
        (files.length - skipped.length === 1 ? '' : 's') + ' into <b>' + out.getPageCount() +
        '</b> page' + (out.getPageCount() === 1 ? '' : 's') + ' — <b>' + fmtBytes(outBlob.size) + '</b>.' +
        (skipped.length ? '<br>⚠ Skipped: ' + escapeHtml(skipped.join(', ')) : '') +
        (droppedChars ? '<br>⚠ ' + droppedChars + ' character(s) outside the Latin alphabet were replaced with "?" — ' +
          'the built-in PDF fonts cannot draw them.' : '');
      p.q('frame').src = URL.createObjectURL(outBlob);
    } catch(e){ p.fail(e.message); }
  };
})();

/* ================= 8. MERGE WORD DOCUMENTS ================= */
(function toolMergeWord(){
  const p = P('mergeword');
  let files = [], outBlob = null;

  makePicker(p.q('pick'), {
    kind:'word', multiple:true, icon:'📝',
    label:'Drag &amp; drop your Word documents',
    sub:'.docx files — they will be joined in the order you arrange them',
    onFiles: fs => { files = files.concat(fs.filter(f => L.isDocx(f))); redraw(); }
  });

  function redraw(){
    L.fileList(p.q('list'), files, redraw);
    p.q('body').classList.toggle('hide', !files.length);
    p.q('count').textContent = files.length
      ? files.length + ' document' + (files.length>1?'s':'') + ' — merged top to bottom'
      : '';
    p.q('go').disabled = files.length < 1;
  }
  redraw();

  p.q('clear').onclick = () => { files = []; redraw(); };
  p.q('again').onclick = () => p.step('body');
  p.q('save').onclick  = () => download(outBlob, 'merged.docx');

  p.q('go').onclick = async () => {
    p.clearErr(); p.step('job'); p.prog(0);
    try {
      p.stat('Reading the documents…');
      const docs = [];
      for (let i = 0; i < files.length; i++){
        docs.push({ name: files[i].name, bytes: await bytesOf(files[i]) });
        p.prog((i+1)/files.length * 0.4);
      }
      p.stat('Merging…');
      await idle();
      outBlob = await Docx.merge(docs, {
        pageBreaks: p.q('breaks').value === '1',
        onProgress: v => p.prog(0.4 + v*0.55)
      });
      p.prog(1);
      p.step('done');
      p.q('msg').innerHTML = '✅ Merged <b>' + files.length + '</b> documents into one — <b>' +
        fmtBytes(outBlob.size) + '</b>.<br>' +
        '<span style="opacity:.8">The first document sets the page size and styles. Where two documents ' +
        'define the same style name differently, the first one wins.</span>';
    } catch(e){ p.fail(e.message); }
  };
})();

/* ================= 9. CONVERT DOCUMENTS ================= */
(function toolConvert(){
  const p = P('convert');
  let file = null, outBlob = null, outName = 'converted';

  const OPTIONS = {
    pdf: [
      ['docx-text',  'Word (.docx) — editable text', 'Rebuilds paragraphs, headings, bold/italic and font sizes. Fully editable. Complex layouts (columns, tables) are flattened into ordinary paragraphs.'],
      ['docx-image', 'Word (.docx) — exact look',    'Each page becomes a full-page picture inside the document. Looks identical to the PDF, but the text is not editable or selectable.'],
      ['images',     'Images (.zip of JPG)',         'Every page rendered as a JPEG, delivered as a ZIP.'],
      ['txt',        'Plain text (.txt)',            'Just the words, in reading order.'],
    ],
    docx: [
      ['pdf', 'PDF', 'Content, headings and images are preserved. Exact Word pagination and fancy layout are approximated — this is a re-layout, not a pixel copy.'],
      ['txt', 'Plain text (.txt)', 'Just the words.'],
    ],
    img: [ ['pdf','PDF','One page per image.'] ],
    txt: [ ['pdf','PDF','Laid out as plain paragraphs.'], ['docx','Word (.docx)','Each line becomes a paragraph.'] ],
  };

  makePicker(p.q('pick'), {
    kind:'docs', icon:'🔄',
    label:'Drag &amp; drop the document to convert',
    sub:'PDF, Word .docx, images or .txt',
    onFile: load
  });

  function kindOf(f){
    return L.isPdf(f) ? 'pdf' : L.isDocx(f) ? 'docx' : L.isImg(f) ? 'img' : L.isTxt(f) ? 'txt' : null;
  }

  function load(f){
    const k = kindOf(f);
    p.clearErr();
    if (!k){
      const e = L.extOf(f.name);
      return p.fail('.' + e + ' files are not supported.' +
        (/^(ppt|pptx|doc|odt|rtf)$/.test(e)
          ? '\n\nPowerPoint and legacy .doc need a real Office engine, which cannot run in a browser. ' +
            'Save the file as PDF or .docx first, then convert it here.'
          : ''));
    }
    file = f;
    const sel = p.q('format');
    sel.innerHTML = '';
    OPTIONS[k].forEach(([v,label]) => {
      const o = el('option'); o.value = v; o.textContent = label; sel.appendChild(o);
    });
    sel.onchange();
    p.q('info').innerHTML = '<span>File <b>' + escapeHtml(f.name) + '</b></span><span>Size <b>' +
      fmtBytes(f.size) + '</b></span><span>Type <b>' + k.toUpperCase() + '</b></span>';
    p.q('pick').classList.add('hide');
    p.q('analysis').classList.add('hide');
    p.step('body');
    if (k === 'pdf') inspect(f);
  }

  /* Look inside the PDF and say what is actually in there, so a scanned
     document is obvious before you spend time converting it. */
  async function inspect(f){
    const box = p.q('analysis');
    box.className = 'note';
    box.classList.remove('hide');
    box.textContent = 'Looking inside the PDF…';
    try {
      const s = await L.analyzePdf(await bytesOf(f));
      const scope = s.sampled < s.pages ? ' (first ' + s.sampled + ' of ' + s.pages + ' pages)' : '';
      if (s.scanned){
        box.className = 'note';
        box.innerHTML = '⚠ <b>This is a scanned PDF.</b> Its pages are photographs — ' +
          s.images + ' image(s) and <b>no text at all</b>' + scope + '.<br>' +
          'The words exist only as pixels, so there is nothing to make editable. ' +
          '<b>Editable-text mode will not work on this file.</b> ' +
          'Choose <b>“exact look”</b>, or run the file through an OCR tool first.';
        p.q('format').value = 'docx-image';
        p.q('format').onchange();
      } else {
        box.className = 'note ok';
        box.innerHTML = '🔎 Found <b>' + s.textItems.toLocaleString() + '</b> text items and <b>' +
          s.images + '</b> embedded image(s) across ' + s.pages + ' page(s)' + scope +
          '. This is a real text PDF, so <b>editable-text mode will work</b>.';
      }
    } catch(e){
      box.className = 'note';
      box.textContent = 'Could not inspect this PDF (' + e.message + ') — you can still try converting it.';
    }
  }

  p.q('format').onchange = () => {
    if (!file) return;
    const k = kindOf(file), v = p.q('format').value;
    const row = (OPTIONS[k] || []).find(o => o[0] === v);
    p.q('fmthint').textContent = row ? row[2] : '';
    p.q('dpi').disabled = !(v === 'images' || v === 'docx-image');
  };

  p.q('another').onclick = () => { p.q('body').classList.add('hide'); p.q('pick').classList.remove('hide'); };
  p.q('again').onclick = () => p.step('body');
  p.q('save').onclick = () => download(outBlob, outName);

  p.q('go').onclick = async () => {
    p.clearErr(); p.step('job'); p.prog(0);
    const fmt = p.q('format').value;
    const scale = +p.q('dpi').value / 72;
    try {
      const bytes = await bytesOf(file);
      const base = baseName(file.name);

      if (fmt === 'docx-text'){
        p.stat('Reading text, images and tables out of the PDF…');
        const { blocks, stats } = await L.pdfToBlocks(bytes, v => p.prog(v*0.7), {
          tables: p.q('tables').value === '1',
          images: p.q('images').value === '1',
        });

        if (!stats.textItems && !stats.images)
          throw new Error('This PDF contains no extractable text or images at all.');

        if (!stats.textItems){
          throw new Error(
            'This is a scanned PDF — every page is a photograph, with no text stored inside it.\n\n' +
            'There is nothing to make editable: the words exist only as pixels. Converting it would ' +
            'need OCR (optical character recognition), which this app does not do.\n\n' +
            'Use "Word (.docx) — exact look" instead to get the pages placed in a document.');
        }

        p.stat('Building the Word document…');
        await idle();
        // pdfToBlocks already emits paragraphs-with-runs, tables and images;
        // only the image field name differs from what the docx builder wants
        const dblocks = blocks.map(b => b.type === 'image'
          ? { type:'image', data:b.bytes, ext:'png', widthPt:b.widthPt, heightPt:b.heightPt }
          : b);
        outBlob = await Docx.build({ blocks: dblocks });
        outName = base + '.docx';

        const paras = dblocks.filter(b => b.type === 'p').length;
        finish('✅ Converted to an editable Word document — <b>' + fmtBytes(outBlob.size) + '</b>.<br>' +
          'Recovered <b>' + paras + '</b> paragraph' + (paras===1?'':'s') +
          ', <b>' + stats.images + '</b> image' + (stats.images===1?'':'s') +
          ' and <b>' + stats.tables + '</b> table' + (stats.tables===1?'':'s') +
          ' across ' + stats.pages + ' page' + (stats.pages===1?'':'s') + '.<br>' +
          '<span style="opacity:.8">Every paragraph, picture and table is a real Word object you can ' +
          'click and edit. Bold, italic and font sizes are preserved per run. Vector drawings and ' +
          'text boxes are not recoverable — a PDF stores them as drawing commands, not objects.</span>');

      } else if (fmt === 'docx-image'){
        p.stat('Rendering the pages…');
        const pages = await L.pdfToImages(bytes, { scale, type:'image/jpeg', quality:0.85 },
                                          v => p.prog(v*0.8));
        p.stat('Building the Word document…');
        const first = pages[0];
        const blocks = [];
        for (let i = 0; i < pages.length; i++){
          if (i) blocks.push({ type:'pagebreak' });
          blocks.push({ type:'image', data:new Uint8Array(await pages[i].blob.arrayBuffer()),
                        ext:'jpeg', widthPt:pages[i].widthPt, heightPt:pages[i].heightPt });
        }
        outBlob = await Docx.build({
          blocks, margin:0,
          page:{ w: Math.round(first.widthPt*20), h: Math.round(first.heightPt*20) }
        });
        outName = base + '.docx';
        finish('✅ Converted to Word with the exact original appearance — <b>' + fmtBytes(outBlob.size) +
          '</b>, ' + pages.length + ' page(s).<br><span style="opacity:.8">Each page is a picture, so it ' +
          'looks identical — but the text cannot be edited or selected. Use "editable text" if you need to change the words.</span>');

      } else if (fmt === 'images'){
        p.stat('Rendering the pages…');
        const pages = await L.pdfToImages(bytes, { scale, type:'image/jpeg', quality:0.88 },
                                          v => p.prog(v*0.9));
        const pad = String(pages.length).length < 3 ? 3 : String(pages.length).length;
        const entries = [];
        for (const pg of pages){
          const b = new Uint8Array(await pg.blob.arrayBuffer());
          entries.push({ name:'page_' + String(pg.index).padStart(pad,'0') + '.jpg',
                         blob:pg.blob, crc:crc32(b), size:b.length });
        }
        outBlob = buildZip(entries);
        outName = base + '_pages.zip';
        finish('✅ ' + pages.length + ' page image(s) — <b>' + fmtBytes(outBlob.size) + '</b> ZIP.');

      } else if (fmt === 'txt'){
        p.stat('Extracting text…');
        let text;
        if (L.isPdf(file)){
          const { blocks } = await L.pdfToBlocks(bytes, v => p.prog(v*0.9));
          text = blocks.map(b => b.type === 'pagebreak' ? '\n\f\n' : b.text).join('\n\n');
        } else {
          const mammoth = await L.need.mammoth();
          const r = await mammoth.extractRawText({ arrayBuffer: bytes.buffer });
          text = r.value;
        }
        outBlob = new Blob([text], { type:'text/plain;charset=utf-8' });
        outName = base + '.txt';
        finish('✅ Extracted <b>' + text.length.toLocaleString() + '</b> characters.');

      } else if (fmt === 'pdf'){
        p.stat('Laying out the PDF…');
        let blocks;
        if (L.isDocx(file)){
          const mammoth = await L.need.mammoth();
          const { value:html } = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
          blocks = L.htmlToBlocks(html);
        } else if (L.isImg(file)){
          blocks = [{ type:'image', bytes, ext: L.extOf(file.name) === 'png' ? 'png' : 'jpg' }];
        } else {
          blocks = new TextDecoder().decode(bytes).split(/\r?\n/)
                    .map(line => ({ text:line, size:11, spaceAfter:2 }));
        }
        p.prog(0.5);
        const { pdf, dropped } = await L.blocksToPdf(blocks);
        outBlob = new Blob([await pdf.save()], { type:'application/pdf' });
        outName = base + '.pdf';
        finish('✅ Converted to PDF — <b>' + fmtBytes(outBlob.size) + '</b>, ' +
          pdf.getPageCount() + ' page(s).' +
          (dropped ? '<br>⚠ ' + dropped + ' non-Latin character(s) became "?" — the built-in PDF fonts cannot draw them.' : '') +
          '<br><span style="opacity:.8">This is a re-layout of the content, not a pixel copy of Word\'s pagination.</span>');

      } else if (fmt === 'docx'){
        p.stat('Building the Word document…');
        const lines = new TextDecoder().decode(bytes).split(/\r?\n/);
        outBlob = await Docx.build({ blocks: lines.map(t => ({ type:'p', runs:[{ text:t }] })) });
        outName = base + '.docx';
        finish('✅ Converted to Word — <b>' + fmtBytes(outBlob.size) + '</b>, ' + lines.length + ' paragraphs.');
      }
    } catch(e){ p.fail(e.message); }

    function finish(html){
      p.prog(1);
      p.step('done');
      p.q('msg').innerHTML = html;
      const prev = p.q('frame');
      if (/\.pdf$/.test(outName)){ prev.classList.remove('hide'); prev.src = URL.createObjectURL(outBlob); }
      else prev.classList.add('hide');
      p.q('save').textContent = '⬇ Download ' + outName.split('.').pop().toUpperCase();
    }
  };
})();

})();
