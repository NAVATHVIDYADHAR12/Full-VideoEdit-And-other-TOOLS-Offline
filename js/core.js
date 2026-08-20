/* core.js — shared plumbing for every tool: DOM helpers, file pickers,
 * the ffmpeg.wasm loader, audio decode/encode, and a dependency-free ZIP writer. */
(function (root) {
'use strict';

/* ================= tiny DOM helpers ================= */
const $  = id => document.getElementById(id);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};

function fmtBytes(b){
  const u = ['B','KB','MB','GB'];
  let i = 0;
  while (b >= 1024 && i < u.length - 1){ b /= 1024; i++; }
  return b.toFixed(i ? 1 : 0) + ' ' + u[i];
}
function fmtTime(s){
  s = Math.max(0, Math.round(s));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s/60) + 'm ' + (s%60) + 's';
  return Math.floor(s/3600) + 'h ' + Math.floor((s%3600)/60) + 'm';
}
function fmtClock(s){
  const m = Math.floor(s/60), r = (s - m*60);
  return m + ':' + (r < 10 ? '0' : '') + r.toFixed(2);
}
function escapeHtml(s){
  return String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}
function baseName(name){ return String(name).replace(/\.[^.]+$/, '') || 'output'; }

function download(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = el('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* ================= reusable file picker =================
 * Renders drag & drop + "Browse" + "Pick from a folder" into a container. */
const VIDEO_RE = /\.(mp4|webm|mov|mkv|avi|m4v|mpg|mpeg|ogv|3gp|ts|flv)$/i;
const AUDIO_RE = /\.(mp3|wav|m4a|aac|ogg|opus|flac|wma|aiff?)$/i;
const DOC_RE   = /\.(pdf|docx?|pptx?|txt|rtf|odt|md)$/i;
const IMG_RE   = /\.(jpe?g|png|gif|bmp|webp|tiff?)$/i;

function makePicker(container, opt){
  opt = opt || {};
  const kind = opt.kind || 'video';                  // 'video' | 'audio' | 'media'
  const re = opt.re || (
      kind === 'audio' ? AUDIO_RE
    : kind === 'media' ? new RegExp(VIDEO_RE.source + '|' + AUDIO_RE.source, 'i')
    : kind === 'docs'  ? new RegExp(DOC_RE.source + '|' + IMG_RE.source, 'i')
    : kind === 'word'  ? /\.docx$/i
    : kind === 'pdf'   ? /\.pdf$/i
    : VIDEO_RE);
  const accept = opt.accept || (
      kind === 'audio' ? 'audio/*'
    : kind === 'media' ? 'video/*,audio/*'
    : kind === 'docs'  ? '.pdf,.docx,.doc,.txt,.rtf,.md,image/*'
    : kind === 'word'  ? '.docx'
    : kind === 'pdf'   ? '.pdf'
    : 'video/*');
  const label  = opt.label || (kind === 'audio' ? 'Drag &amp; drop an audio file' : 'Drag &amp; drop a video file');
  const sub    = opt.sub || (kind === 'audio'
      ? 'MP3, WAV, M4A, AAC, OGG, FLAC — from anywhere on your PC'
      : 'MP4, WebM, MOV, MKV — from your Desktop, Downloads, a USB drive, anywhere');

  container.innerHTML =
    '<div class="drop">' +
      '<span class="ic">' + (opt.icon || (kind === 'audio' ? '🎵' : '🎬')) + '</span>' +
      '<h3>' + label + '</h3><p>' + sub + '</p>' +
      '<div class="row" style="justify-content:center;margin-top:16px">' +
        '<button type="button" data-act="file">📁 Browse for a file…</button>' +
        '<button type="button" class="ghost" data-act="dir">🗂 Pick from a folder…</button>' +
      '</div>' +
    '</div>' +
    '<div class="card hide" data-el="picker">' +
      '<label>Files found in that folder</label>' +
      '<select data-el="list" size="6"></select>' +
      '<div class="row" style="margin-top:14px">' +
        '<button type="button" data-act="use">Use this file</button>' +
        '<button type="button" class="ghost" data-act="back">Back</button>' +
      '</div>' +
    '</div>' +
    '<div class="note err hide" data-el="err"></div>';

  const drop   = container.querySelector('.drop');
  const picker = container.querySelector('[data-el=picker]');
  const list   = container.querySelector('[data-el=list]');
  const errEl  = container.querySelector('[data-el=err]');

  const fileIn = el('input'); fileIn.type = 'file'; fileIn.accept = accept; fileIn.className = 'hide';
  const dirIn  = el('input'); dirIn.type = 'file'; dirIn.className = 'hide';
  dirIn.webkitdirectory = true;
  container.append(fileIn, dirIn);

  let found = [];
  const fail = m => { errEl.textContent = m; errEl.classList.remove('hide'); };
  const clear = () => errEl.classList.add('hide');
  const isMatch = f => {
    const t = f.type || '';
    const byType = kind === 'audio' ? t.startsWith('audio/')
                 : kind === 'media' ? (t.startsWith('audio/') || t.startsWith('video/'))
                 : kind === 'docs'  ? (t.startsWith('image/') || t === 'application/pdf')
                 : (kind === 'word' || kind === 'pdf') ? false
                 : t.startsWith('video/');
    return byType || re.test(f.name);
  };

  // single-file tools get onFile(f); multi-file tools get onFiles([...]) and the
  // drop zone stays put so more files can be added
  const pick = f => { if (!f) return; clear(); opt.multiple ? opt.onFiles([f]) : opt.onFile(f); };
  const pickMany = fs => { if (!fs.length) return; clear(); opt.onFiles(fs); };
  if (opt.multiple) fileIn.multiple = true;

  drop.onclick = e => { if (e.target.tagName !== 'BUTTON') fileIn.click(); };
  drop.querySelector('[data-act=file]').onclick = e => { e.stopPropagation(); fileIn.click(); };
  drop.querySelector('[data-act=dir]').onclick  = e => { e.stopPropagation(); dirIn.click(); };

  ['dragenter','dragover'].forEach(ev =>
    drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave','dragend'].forEach(ev =>
    drop.addEventListener(ev, () => drop.classList.remove('over')));
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('over');
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    const ok = files.filter(isMatch);
    if (opt.multiple) pickMany(ok.length ? ok : files);
    else if (ok.length > 1) showFolder(ok);
    else pick(ok[0] || files[0]);
  });

  fileIn.onchange = () => {
    if (opt.multiple) pickMany([...fileIn.files]); else pick(fileIn.files[0]);
    fileIn.value = '';
  };
  dirIn.onchange = () => {
    const ok = [...dirIn.files].filter(isMatch);
    dirIn.value = '';
    if (!ok.length) return fail('No matching files were found in that folder.');
    if (opt.multiple) return pickMany(ok);
    if (ok.length === 1) return pick(ok[0]);
    showFolder(ok);
  };

  function showFolder(files){
    found = files.sort((a,b) => a.name.localeCompare(b.name));
    list.innerHTML = '';
    found.forEach((f,i) => {
      const o = el('option');
      o.value = i;
      o.textContent = (f.webkitRelativePath || f.name) + '  —  ' + fmtBytes(f.size);
      list.appendChild(o);
    });
    list.selectedIndex = 0;
    list.size = Math.min(10, Math.max(3, found.length));
    clear();
    drop.classList.add('hide');
    picker.classList.remove('hide');
  }
  const use = () => { picker.classList.add('hide'); drop.classList.remove('hide'); pick(found[list.selectedIndex|0]); };
  list.ondblclick = use;
  picker.querySelector('[data-act=use]').onclick  = use;
  picker.querySelector('[data-act=back]').onclick = () => { picker.classList.add('hide'); drop.classList.remove('hide'); };

  return { fail, clear, reset(){ picker.classList.add('hide'); drop.classList.remove('hide'); clear(); } };
}

/* ================= ffmpeg.wasm loader =================
 * Tries every sensible way to start the engine rather than betting on one.
 * A single failure used to be fatal: if the multithreaded core would not start,
 * or the vendored copy was half-present, the whole thing gave up instead of
 * falling back to something that works. */
const FF = (function(){
  let instance = null, loading = null, usingCDN = false, usingMT = false;
  const isFile = location.protocol === 'file:';
  const CDN = 'https://unpkg.com/@ffmpeg/';

  const threaded = () => (typeof SharedArrayBuffer !== 'undefined') && self.crossOriginIsolated === true;

  /** Anything at all can be thrown or rejected — always produce something readable.
   *  This is why the old message said "undefined": it assumed an Error. */
  function errText(e){
    if (e == null) return 'no reason given';
    if (typeof e === 'string') return e;
    if (e.message) return e.message;
    if (e.reason) return errText(e.reason);
    if (e.statusText) return e.statusText;
    if (e.type) return 'a "' + e.type + '" event with no detail';
    try {
      const s = String(e);
      if (s && s !== '[object Object]') return s;
    } catch(_){}
    return 'no reason given';
  }

  function loadScript(src){
    return new Promise((res, rej) => {
      if ([...document.scripts].some(s => s.src === src || s.src.endsWith(src))) return res();
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => res();
      s.onerror = () => rej(new Error('could not fetch ' + src));
      document.head.appendChild(s);
    });
  }

  /* The wrapper and the class worker are the UMD bundles -- they are loaded as a
   * classic <script> and as the worker's own source. The CORE, however, must be
   * the ESM build: ffmpeg.wasm starts that worker with {type:"module"}, where
   * importScripts() does not exist, so the worker falls back to a dynamic
   * import() and reads .default. Only the ESM core exports one. Handing it the
   * UMD core leaves createFFmpegCore undefined and it reports
   * "failed to import ffmpeg-core.js". */
  function srcFor(where, mt){
    const pkg = mt ? 'core-mt@0.12.6' : 'core@0.12.6';
    if (where === 'cdn') return {
      lib : CDN + 'ffmpeg@0.12.10/dist/umd/ffmpeg.js',
      util: CDN + 'util@0.12.1/dist/umd/index.js',
      core: CDN + pkg + '/dist/esm/ffmpeg-core.js',
      wasm: CDN + pkg + '/dist/esm/ffmpeg-core.wasm',
      work: CDN + pkg + '/dist/esm/ffmpeg-core.worker.js',
      cls : CDN + 'ffmpeg@0.12.10/dist/umd/814.ffmpeg.js',
    };
    return {
      lib : 'vendor/ffmpeg.js',
      util: 'vendor/ffmpeg-util.js',
      core: mt ? 'vendor/ffmpeg-core-mt-esm.js' : 'vendor/ffmpeg-core-esm.js',
      wasm: mt ? 'vendor/ffmpeg-core-mt.wasm'   : 'vendor/ffmpeg-core.wasm',
      work: 'vendor/ffmpeg-core-mt-esm.worker.js',
      cls : 'vendor/814.ffmpeg.js',
    };
  }

  /** Is the vendored engine actually sitting there? file:// cannot fetch it at all. */
  async function vendorPresent(mt){
    if (isFile) return false;
    try {
      const r = await fetch(srcFor('local', mt).wasm, { method:'HEAD' });
      return r.ok;
    } catch(_){ return false; }
  }

  async function attempt(where, mt, hooks, say){
    const src = srcFor(where, mt);
    say('Starting ffmpeg — ' + (mt ? 'multithreaded' : 'single-threaded') +
        ', ' + (where === 'cdn' ? 'from the CDN' : 'offline copy') + '…');

    await loadScript(src.lib);
    await loadScript(src.util);
    if (!self.FFmpegWASM || !self.FFmpegWASM.FFmpeg)
      throw new Error('the ffmpeg wrapper loaded but did not register itself');
    if (!self.FFmpegUtil || !self.FFmpegUtil.toBlobURL)
      throw new Error('the ffmpeg helpers loaded but did not register themselves');

    const { FFmpeg } = self.FFmpegWASM;
    const { toBlobURL } = self.FFmpegUtil;

    say('Fetching the engine (~32 MB, cached after the first time)…');
    const cfg = {
      coreURL: await toBlobURL(src.core, 'text/javascript'),
      wasmURL: await toBlobURL(src.wasm, 'application/wasm'),
      classWorkerURL: await toBlobURL(src.cls, 'text/javascript'),
    };
    if (mt) cfg.workerURL = await toBlobURL(src.work, 'text/javascript');

    const ff = new FFmpeg();
    if (hooks.onLog) ff.on('log', ({ message }) => hooks.onLog(message));
    say('Warming up…');
    await ff.load(cfg);

    usingCDN = where === 'cdn';
    usingMT = mt;
    return ff;
  }

  /** @returns {Promise<FFmpeg>} */
  function load(hooks){
    hooks = hooks || {};
    if (instance) return Promise.resolve(instance);
    if (loading)  return loading;

    loading = (async () => {
      const say = m => hooks.onStatus && hooks.onStatus(m);
      const mt = threaded();

      const localMT = mt ? await vendorPresent(true) : false;
      const localST = await vendorPresent(false);

      // Best first, then progressively safer. The single-threaded core has no
      // worker plumbing to go wrong, so it is the reliable last resort.
      const plans = [];
      if (localMT) plans.push(['local', true]);
      if (localST) plans.push(['local', false]);
      if (mt)      plans.push(['cdn', true]);
      plans.push(['cdn', false]);

      const failures = [];
      for (const [where, m] of plans){
        try {
          const ff = await attempt(where, m, hooks, say);
          instance = ff;
          say('ffmpeg ready — ' + (m ? 'multithreaded' : 'single-threaded') +
              (where === 'cdn' ? ', from the CDN' : ', offline copy'));
          return ff;
        } catch(e){
          failures.push((where === 'cdn' ? 'CDN' : 'local') + ' / ' +
                        (m ? 'multithreaded' : 'single-threaded') + ' — ' + errText(e));
          say('That route failed, trying another…');
        }
      }

      const advice = isFile
        ? 'You opened the file directly. Run start.bat instead — a file:// page cannot load the local engine, so everything has to come from the internet.'
        : (localMT || localST)
          ? 'The offline engine is present but would not start. Reloading the page usually clears this.'
          : 'There is no offline engine here, so it must come from the internet. Check your connection, or run "node fetch-vendor.js" once to work offline afterwards.';

      throw new Error('ffmpeg could not start.\n\n' + advice +
                      '\n\nEverything that was tried:\n  • ' + failures.join('\n  • '));
    })().catch(e => { loading = null; throw e; });

    return loading;
  }

  /** Run one ffmpeg command. inputs = [{name, data}], returns Uint8Array of outName. */
  async function run(args, inputs, outName, hooks){
    hooks = hooks || {};
    const ff = await load(hooks);
    const { fetchFile } = self.FFmpegUtil;

    const onProg = ({ progress }) => hooks.onProgress && hooks.onProgress(Math.min(1, Math.max(0, progress)));
    ff.on('progress', onProg);
    try {
      for (const inp of inputs) await ff.writeFile(inp.name, await fetchFile(inp.data));
      const code = await ff.exec(args);
      if (code) throw new Error('ffmpeg exited with code ' + code + ' — the command or the input codec was rejected.');
      const out = await ff.readFile(outName);
      if (!out || !out.length) throw new Error('ffmpeg produced an empty file — the input codec may be unsupported.');
      for (const inp of inputs) { try { await ff.deleteFile(inp.name); } catch(_){} }
      try { await ff.deleteFile(outName); } catch(_){}
      return out;
    } finally {
      ff.off && ff.off('progress', onProg);
    }
  }

  /** Kill the running engine. The only way to abort an ffmpeg command already
   *  in flight — the next load() builds a fresh instance. */
  function terminate(){
    if (!instance) return false;
    try { instance.terminate(); } catch(_){}
    instance = null;
    loading = null;
    return true;
  }

  return { load, run, terminate, threaded, errText,
           get usingCDN(){ return usingCDN; },
           get usingMT(){ return usingMT; },
           get loaded(){ return !!instance; } };
})();

/* ================= audio helpers ================= */
let actx = null;
function audioCtx(){
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  return actx;
}

/** Decode any file the browser can handle into an AudioBuffer. */
async function decodeAudio(file){
  const buf = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  return await audioCtx().decodeAudioData(buf.slice(0));
}

/** Float32 channels -> 16-bit PCM WAV Blob. */
function encodeWAV(channels, sampleRate){
  const n = channels[0].length, ch = channels.length;
  const buf = new ArrayBuffer(44 + n * ch * 2);
  const v = new DataView(buf);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };

  str(0, 'RIFF');           v.setUint32(4, 36 + n*ch*2, true);
  str(8, 'WAVE');           str(12, 'fmt ');
  v.setUint32(16, 16, true);        v.setUint16(20, 1, true);       // PCM
  v.setUint16(22, ch, true);        v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate*ch*2, true);
  v.setUint16(32, ch*2, true);      v.setUint16(34, 16, true);
  str(36, 'data');          v.setUint32(40, n*ch*2, true);

  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++){
      let s = Math.max(-1, Math.min(1, channels[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      o += 2;
    }
  return new Blob([buf], { type:'audio/wav' });
}

function bufferToChannels(ab){
  const out = [];
  for (let c = 0; c < ab.numberOfChannels; c++) out.push(ab.getChannelData(c));
  return out;
}

/** Draw a waveform, optionally highlighting a selected region [a,b] in seconds. */
function drawWave(canvas, chan, duration, sel){
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth || 600, H = canvas.clientHeight || 90;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const c = canvas.getContext('2d');
  c.scale(dpr, dpr);
  c.clearRect(0,0,W,H);

  if (sel){
    c.fillStyle = 'rgba(79,140,255,.20)';
    const x0 = sel[0]/duration*W, x1 = sel[1]/duration*W;
    c.fillRect(x0, 0, Math.max(2, x1-x0), H);
  }

  const step = Math.max(1, Math.floor(chan.length / W));
  const mid = H/2;
  const grad = c.createLinearGradient(0,0,W,0);
  grad.addColorStop(0,'#22d3ee'); grad.addColorStop(1,'#0891b2');
  c.strokeStyle = grad; c.lineWidth = 1;
  c.beginPath();
  for (let x = 0; x < W; x++){
    let min = 1, max = -1;
    for (let i = 0; i < step; i++){
      const s = chan[x*step + i];
      if (s == null) break;
      if (s < min) min = s;
      if (s > max) max = s;
    }
    c.moveTo(x + .5, mid + min*mid*0.95);
    c.lineTo(x + .5, mid + max*mid*0.95);
  }
  c.stroke();
  c.strokeStyle = 'rgba(255,255,255,.12)';
  c.beginPath(); c.moveTo(0, mid); c.lineTo(W, mid); c.stroke();
}

/* ================= store-only ZIP writer ================= */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++){
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes){
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function buildZip(entries){
  const parts = [], central = [];
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours()<<11) | (now.getMinutes()<<5) | (now.getSeconds()>>1);
  const dosDate = ((now.getFullYear()-1980)<<9) | ((now.getMonth()+1)<<5) | now.getDate();
  let offset = 0;

  for (const e of entries){
    const name = enc.encode(e.name);
    const lbuf = new ArrayBuffer(30 + name.length), lh = new DataView(lbuf);
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true);
    lh.setUint16(6, 0, true);          lh.setUint16(8, 0, true);   // stored
    lh.setUint16(10, dosTime, true);   lh.setUint16(12, dosDate, true);
    lh.setUint32(14, e.crc, true);     lh.setUint32(18, e.size, true);
    lh.setUint32(22, e.size, true);    lh.setUint16(26, name.length, true);
    lh.setUint16(28, 0, true);
    new Uint8Array(lbuf).set(name, 30);
    parts.push(lbuf, e.blob);

    const cbuf = new ArrayBuffer(46 + name.length), cd = new DataView(cbuf);
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true);
    cd.setUint16(8, 0, true);          cd.setUint16(10, 0, true);
    cd.setUint16(12, dosTime, true);   cd.setUint16(14, dosDate, true);
    cd.setUint32(16, e.crc, true);     cd.setUint32(20, e.size, true);
    cd.setUint32(24, e.size, true);    cd.setUint16(28, name.length, true);
    cd.setUint16(30, 0, true);         cd.setUint16(32, 0, true);
    cd.setUint16(34, 0, true);         cd.setUint16(36, 0, true);
    cd.setUint32(38, 0, true);         cd.setUint32(42, offset, true);
    new Uint8Array(cbuf).set(name, 46);
    central.push(cbuf);
    offset += 30 + name.length + e.size;
  }

  const cdSize = central.reduce((n,b) => n + b.byteLength, 0);
  const ebuf = new ArrayBuffer(22), eo = new DataView(ebuf);
  eo.setUint32(0, 0x06054b50, true);
  eo.setUint16(8, entries.length, true);  eo.setUint16(10, entries.length, true);
  eo.setUint32(12, cdSize, true);         eo.setUint32(16, offset, true);
  return new Blob(parts.concat(central, [ebuf]), { type:'application/zip' });
}

/* ================= video frame seeking ================= */
/** Seek a <video> and resolve once the new frame is really decoded and painted. */
function seek(v, time){
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      v.removeEventListener('seeked', onSeeked);
      resolve();
    };
    const onSeeked = () => {
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(finish);
      setTimeout(finish, 60);
    };
    const timer = setTimeout(finish, 5000);
    v.addEventListener('seeked', onSeeked, { once:true });
    v.onerror = () => { if (!settled){ settled = true; reject(new Error('video decode error while seeking')); } };
    v.currentTime = Math.min(time, Math.max(0, v.duration - 0.001));
  });
}

const idle = () => new Promise(r => setTimeout(r, 0));

root.Core = {
  $, el, fmtBytes, fmtTime, fmtClock, escapeHtml, baseName, download,
  makePicker, VIDEO_RE, AUDIO_RE, DOC_RE, IMG_RE,
  FF, audioCtx, decodeAudio, encodeWAV, bufferToChannels, drawWave,
  crc32, buildZip, seek, idle,
};

})(window);
