/* assistant.js — the Studio Assistant.
 *
 * A local, deterministic help desk: it matches what you type against a
 * knowledge base written from what this toolkit actually does, and it can open
 * the right tool for you. There is no model and no network call — which is the
 * only honest way to ship a helper inside an app whose promise is that nothing
 * leaves your machine.
 *
 * It says "I do not know that one" rather than inventing an answer.
 */
(function () {
'use strict';

const fab   = document.getElementById('chatfab');
const panel = document.getElementById('chat');
const log   = document.getElementById('chatlog');
const form  = document.getElementById('chatform');
const input = document.getElementById('chatinput');
const chips = document.getElementById('chatchips');
const closeBtn = document.getElementById('chatclose');
if (!fab || !panel) return;

/* ================= knowledge base ================= */
/* `keys` are matched against the question; longer phrases score higher, so a
   specific question beats a vague one. */
const KB = [
  {
    keys:['what is this','what can you do','overview','help','about','tools','what does this do','start'],
    a:'This is a studio of <b>ten tools</b> that run entirely in your browser — video editing, watermark removal, frame extraction, audio work and document conversion. Nothing is uploaded; your files never leave this machine.<br><br>Tell me what you are trying to do and I will point you at the right one.',
    acts:[['Open the editor','editor'],['Browse tools','']]
  },
  {
    keys:['watermark','logo','remove watermark','erase logo','timestamp','bug','delogo'],
    a:'Box the watermark and pick a method. <b>Inpaint</b> fills the hole from the surrounding pixels — near-perfect over sky, blur or gradients. <b>Blur</b> and <b>pixelate</b> always work but hide rather than remove. <b>Crop</b> cuts the pixels away entirely.<br><br>Honest limit: over fine texture, inpainting smudges. Nothing in a browser can recover detail the watermark is covering.',
    acts:[['Remove from a video','wmvideo'],['Remove while extracting frames','frames']]
  },
  {
    keys:['frames','jpg','jpeg','extract frames','screenshot','still','image sequence','30 fps','fps'],
    a:'The frame extractor pulls a clip apart into numbered JPEGs and hands you a ZIP. 30&nbsp;fps by default, or any rate you like. You can also bake watermark removal into every frame as it is written.<br><br>Rough speed: about 10–20 frames a second, so a minute of 30&nbsp;fps video takes a few minutes.',
    acts:[['Extract frames','frames']]
  },
  {
    keys:['extract audio','get audio','rip audio','pull the audio','audio out','take the audio','soundtrack','audio from video','audio','mp3','wav','m4a'],
    a:'Save a soundtrack as <b>WAV</b> (instant, decoded right here, no engine download), or <b>MP3</b> / <b>M4A</b> through ffmpeg. There is also a "copy the original stream" option that lifts the audio out without re-encoding it at all.',
    acts:[['Extract audio','extract']]
  },
  {
    keys:['mute','remove audio','silence','no sound','strip audio'],
    a:'Muting stream-copies the picture and drops the audio track, so it is <b>lossless and near-instant</b> no matter how long the video is — the video is never re-encoded.',
    acts:[['Mute a video','mute']]
  },
  {
    keys:['add music','merge audio','soundtrack to video','background music','replace audio','combine audio'],
    a:'Put a new soundtrack on a video, either replacing the original or mixed underneath it with independent volume for each. The video stream is copied rather than re-encoded, so quality is untouched.',
    acts:[['Merge audio into video','merge']]
  },
  {
    keys:['noise','hiss','hum','denoise','background noise','clean audio','noise cancellation'],
    a:'Spectral subtraction: the audio is split into overlapping windows, a per-frequency noise floor is estimated, and that floor is subtracted with a little residual left in so it does not turn watery.<br><br>Measured on test signal: <b>17–18&nbsp;dB of noise removed for 0.3&nbsp;dB of signal loss</b>. Mark a noise-only stretch on the waveform for the best result, or let it find one.',
    acts:[['Clean up audio','denoise']]
  },
  {
    keys:['edit','editor','timeline','cut','trim','split','clips','tracks','nle','montage'],
    a:'The editor is a real timeline: drag video, audio and stills onto layered tracks, trim by dragging an edge, split at the playhead with <code>S</code>, and move clips between tracks.<br><br>Each clip has its own opacity, scale, position, rotation, speed, volume and fades. <code>Space</code> plays, arrow keys step a frame.',
    acts:[['Open the editor','editor']]
  },
  {
    keys:['export','render','save video','save my video','download the result','output','how long','render time'],
    a:'Export renders every frame through a canvas and muxes it into an MP4. Where your browser supports WebCodecs it encodes H.264 directly, which is much faster; otherwise it falls back to ffmpeg.<br><br>You get a throughput readout when it finishes, so a short test tells you what a long render will cost. <b>Try five seconds first.</b>',
    acts:[['Open the editor','editor']]
  },
  {
    keys:['pdf to word','convert pdf','pdf into word','editable','docx from pdf'],
    a:'Two modes, because there is a real trade-off. <b>Editable text</b> rebuilds paragraphs, runs, pictures and column-aligned tables as genuine Word objects. <b>Exact look</b> puts each page in as a picture — identical, but not editable.<br><br>A <b>scanned</b> PDF has no text inside it at all; the tool checks first and tells you, since that case needs OCR which this app does not do.',
    acts:[['Convert a document','convert']]
  },
  {
    keys:['merge pdf','combine pdf','join pdf','one pdf','pdf together'],
    a:'Drop in any number of PDFs, images, Word files and text documents, arrange them in the order you want, and get a single PDF back.',
    acts:[['Merge into one PDF','mergepdf']]
  },
  {
    keys:['merge word','combine word','join docx','word documents together'],
    a:'Joins .docx files into one, carrying across images, lists and numbering. The first document sets the page size and styles; where two documents define the same style name differently, the first one wins.',
    acts:[['Merge Word files','mergeword']]
  },
  {
    keys:['word to pdf','docx to pdf','convert word'],
    a:'Word to PDF keeps headings, bold and italic, lists, tables and images. It is a <b>re-layout</b> rather than a pixel copy of Word\'s pagination, so line breaks may fall differently. Non-Latin characters become "?" and are counted for you, because the built-in PDF fonts are Latin-only.',
    acts:[['Convert a document','convert']]
  },
  {
    keys:['powerpoint','ppt','pptx','slides','presentation'],
    a:'PowerPoint is <b>not supported</b>, and I would rather say so than pretend. Converting .ppt or .pptx properly needs a real Office engine such as LibreOffice, which cannot run in a browser. Save the file as PDF first and everything here will handle it.'
  },
  {
    keys:['offline','privacy','upload','private','secure','internet','data','safe','server'],
    a:'Nothing is uploaded — there is no upload endpoint in this application at all. Decoding, processing and encoding happen in your browser, which is why it still works with the network unplugged.<br><br>Even when hosted, the server only sends the page itself. Your footage never reaches it.'
  },
  {
    keys:['format','support','codec','mkv','mov','webm','avi','file type','which files'],
    a:'Video: <b>MP4, WebM, MOV, MKV, AVI</b> and anything else your browser can decode. Audio: <b>MP3, WAV, M4A, AAC, OGG, FLAC</b>. Images: <b>JPG, PNG, GIF, BMP, WebP</b>. Documents: <b>PDF, DOCX, TXT</b>.<br><br>MP4 with H.264 is the safest bet everywhere.'
  },
  {
    keys:['ffmpeg','engine','failed to load','not working','error','failed','broken','wont start'],
    a:'If the engine will not start, the message now names every route it tried and why each failed — read that first, it is usually specific.<br><br>Two common fixes: reload the page, and if you are running it locally, open it through <code>start.bat</code> rather than double-clicking the HTML. That serves it properly and uses the offline copy.'
  },
  {
    keys:['slow','speed','faster','performance','takes long','laggy'],
    a:'Two things dominate. Frame work is seek-decode-encode per frame, so it is inherently paced by your machine. And ffmpeg runs several times faster when the page is <b>cross-origin isolated</b> — locally that means launching via <code>start.bat</code>.<br><br>Lowering the resolution or frame rate is the other big lever.'
  },
  {
    keys:['install','setup','run locally','install locally','offline copy','clone','github'],
    a:'Clone the repository, run <code>node fetch-vendor.js</code> once to pull down the ffmpeg engine, then launch <code>start.bat</code>. After that it works with no internet at all.<br><br>Skipping the fetch step still works — the engine just comes from a CDN each session instead.'
  },
  {
    keys:['size limit','how big','large file','maximum','gb','memory'],
    a:'There is no fixed limit, but everything is held in browser memory, so multi-gigabyte files can run out of room. For long videos, work in sections or lower the resolution.<br><br>Muting and merging audio are the exceptions — they stream-copy, so length costs almost nothing.'
  },
  {
    keys:['ocr','scan','scanned','scanned pdf','is a scan','photo of text','text from image'],
    a:'OCR is <b>not</b> included. If a PDF is a scan, its pages are photographs and the words exist only as pixels — the converter detects this and tells you rather than handing you an empty document. Run it through an OCR tool first, then come back.'
  },
  {
    keys:['transition','crossfade','fade between','effects'],
    a:'Per-clip <b>fades</b> are there — fade in and out on both video and audio — along with opacity, scale, position, rotation, colour filters and speed.<br><br><b>Transitions between clips</b> (crossfades) and keyframed animation are not built yet. I would rather tell you than let you go looking.'
  },
  {
    keys:['youtube','youtube video','download from youtube','link','url','instagram','tiktok','pinterest'],
    a:'Downloading from YouTube or similar sites is not possible here, and not only for technical reasons — a browser cannot fetch those files, and their terms prohibit it. This toolkit works on files you already have.'
  },
];

const FALLBACK_CHIPS = [
  'How do I remove a watermark?',
  'Extract audio from a video',
  'Is anything uploaded?',
  'How do I export?',
];

/* ================= matching ================= */
const norm = s => ' ' + String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';

function findAnswer(q){
  const text = norm(q);

  /* Tolerate the plural people actually type ("pdfs" for a "pdf" key). Only in
     that direction: stripping an s as well would let the key "pdfs" match a
     question about one pdf, which sent "my pdf is a scan" to the wrong entry. */
  const has = w => text.indexOf(' ' + w + ' ') >= 0 || text.indexOf(' ' + w + 's ') >= 0;

  let best = null, bestScore = 0;
  for (const entry of KB){
    let score = 0;
    for (const key of entry.keys){
      const k = norm(key).trim();
      if (!k) continue;
      const parts = k.split(' ');

      if (parts.length === 1){
        if (has(k)) score += 1.5;
      } else if (text.indexOf(' ' + k + ' ') >= 0 || text.indexOf(k) >= 0){
        score += parts.length * 3;          // said as a phrase: the strongest signal
      } else if (parts.every(has)){
        score += parts.length * 2;          // same words, scattered through the sentence
      }
    }
    if (score > bestScore){ bestScore = score; best = entry; }
  }
  return bestScore >= 1.5 ? best : null;
}

/* ================= rendering ================= */
function bubble(who, html){
  const d = document.createElement('div');
  d.className = 'msg ' + who;
  d.innerHTML = html;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
  return d;
}

function addActions(node, acts){
  if (!acts || !acts.length) return;
  const wrap = document.createElement('div');
  wrap.className = 'acts';
  for (const [label, target] of acts){
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.onclick = () => {
      // the router already listens for hash changes, so this drives it
      if (target) location.hash = target;
      else document.getElementById('tools').scrollIntoView({ behavior:'smooth' });
      close();
    };
    wrap.appendChild(b);
  }
  node.appendChild(wrap);
  log.scrollTop = log.scrollHeight;
}

function setChips(list){
  chips.innerHTML = '';
  for (const text of list){
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.onclick = () => ask(text);
    chips.appendChild(b);
  }
}

function thinking(){
  const d = bubble('bot', '<span class="typing"><i></i><i></i><i></i></span>');
  return d;
}

/* ================= conversation ================= */
let busy = false;

function ask(q){
  q = String(q || '').trim();
  if (!q || busy) return;
  busy = true;
  input.value = '';
  bubble('me', q.replace(/[<>&]/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;' }[c])));
  chips.innerHTML = '';

  const dots = thinking();
  const hit = findAnswer(q);
  // a short pause so the answer registers as a reply rather than a page update
  setTimeout(() => {
    dots.remove();
    if (hit){
      const node = bubble('bot', hit.a);
      addActions(node, hit.acts);
    } else {
      bubble('bot',
        'I do not have an answer for that one — I only know this toolkit, and I would rather ' +
        'say so than guess.<br><br>Try asking about a specific job: removing a watermark, ' +
        'extracting frames or audio, editing on the timeline, muting, merging, cleaning up ' +
        'noise, or converting documents.');
    }
    setChips(FALLBACK_CHIPS);
    busy = false;
  }, 420 + Math.random() * 260);
}

form.addEventListener('submit', e => { e.preventDefault(); ask(input.value); });

/* ================= open / close ================= */
let started = false;
function open(){
  panel.classList.add('open');
  fab.classList.add('open');
  fab.setAttribute('aria-label', 'Close the assistant');
  if (!started){
    started = true;
    bubble('bot',
      'Good to see you. I can explain any of the ten tools, point you at the right one, ' +
      'or talk through what this app can and cannot do.<br><br>' +
      '<b>Everything here runs on your machine</b> — including me. I am a local index of this ' +
      'toolkit, not a language model, so I answer from what was actually built.');
    setChips(FALLBACK_CHIPS);
  }
  setTimeout(() => input.focus(), 260);
}
function close(){
  panel.classList.remove('open');
  fab.classList.remove('open');
  fab.setAttribute('aria-label', 'Open the assistant');
}
function toggle(){ panel.classList.contains('open') ? close() : open(); }

fab.addEventListener('click', toggle);
closeBtn.addEventListener('click', close);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && panel.classList.contains('open')) close();
});

})();
