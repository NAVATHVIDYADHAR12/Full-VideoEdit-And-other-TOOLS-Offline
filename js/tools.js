/* tools.js — the six tool controllers and the router between them. */
(function () {
'use strict';

const C = window.Core, D = window.DSP, WM = window.WM;
const { el, fmtBytes, fmtTime, escapeHtml, baseName, download, makePicker,
        FF, decodeAudio, encodeWAV, bufferToChannels, drawWave,
        crc32, buildZip, seek, idle, VIDEO_RE } = C;

/* ================= router ================= */
const home = document.getElementById('home');
const panels = [...document.querySelectorAll('.panel')];

function show(name){
  home.classList.toggle('hide', !!name);
  panels.forEach(p => p.classList.toggle('hide', p.id !== 'panel-' + name));
  location.hash = name || '';
  window.scrollTo(0,0);
}
document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => show(b.dataset.go));
document.querySelectorAll('[data-back]').forEach(b => b.onclick = () => show(''));
window.addEventListener('hashchange', () => {
  const h = location.hash.replace('#','');
  if (!h) show('');
  else if (document.getElementById('panel-' + h)) show(h);
});

/* ================= per-panel helper ================= */
function P(id){
  const root = document.getElementById('panel-' + id);
  const q  = s => root.querySelector('[data-el=' + s + ']');
  const job = q('job');
  const api = {
    root, q,
    step(which){
      ['body','job','done'].forEach(k => { const n = q(k); if (n) n.classList.toggle('hide', k !== which); });
    },
    prog(v){ const f = job && job.querySelector('.bar > i'); if (f) f.style.width = (v*100).toFixed(1) + '%'; },
    stat(t){ const n = job && job.querySelector('[data-el=stat]'); if (n) n.textContent = t; },
    eta(t){ const n = job && job.querySelector('[data-el=eta]'); if (n) n.textContent = t || ''; },
    log(line){
      const n = q('log');
      if (!n) return;
      n.classList.remove('hide');
      n.textContent = (n.textContent + '\n' + line).split('\n').slice(-60).join('\n');
      n.scrollTop = n.scrollHeight;
    },
    clearLog(){ const n = q('log'); if (n){ n.textContent = ''; n.classList.add('hide'); } },
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

/* ffmpeg hooks bound to a panel */
function hooks(p, label){
  return {
    onStatus: m => p.stat(m),
    onLog: m => p.log(m),
    onProgress: v => { p.prog(v); p.stat(label + ' — ' + (v*100).toFixed(0) + '%'); },
  };
}

const extOf = n => (String(n).match(/\.([^.]+)$/) || [,'mp4'])[1].toLowerCase();

/* ================= where are we running? ================= */
const ENV = (function(){
  const isFile = location.protocol === 'file:';
  const isLocal = /^(localhost|127\.|0\.0\.0\.0|\[::1\]|::1)/.test(location.hostname);
  return { isFile, isLocal, hosted: !isFile && !isLocal, mt: FF.threaded() };
})();

/* Advice that actually applies where the app is running — telling a visitor on a
   hosted site to "run start.bat" would be nonsense. */
function speedTip(){
  if (ENV.mt) return '';
  if (ENV.isFile)  return ' Open it through <code>start.bat</code> instead to go several times faster.';
  if (ENV.isLocal) return ' Restart via <code>start.bat</code> so the COOP/COEP headers are sent.';
  return ' This deployment is not cross-origin isolated, so ffmpeg is single-threaded.';
}


/* Run ffmpeg, retrying with a fallback argument set if the first attempt fails.
 * Returns {data, out} — `out` matters because a fallback may write a different
 * filename (and therefore a different extension) than the first attempt. */
async function ffRun(p, args, inputs, out, label, fallback){
  try {
    return { data: await FF.run(args, inputs, out, hooks(p, label)), out };
  } catch (e){
    if (!fallback) throw e;
    p.log('First attempt failed (' + e.message + ') — retrying: ' + fallback.why);
    p.stat(fallback.why);
    const out2 = fallback.out || out;
    return { data: await FF.run(fallback.args, inputs, out2, hooks(p, label)), out: out2 };
  }
}

/* ================= 1. VIDEO -> JPG FRAMES ================= */
(function toolFrames(){
  const p = P('frames');
  let file = null, zipBlob = null, cancelled = false, wm = null, srcURL = null;
  const video = p.q('video');

  p.q('wmBody').innerHTML = WM.markup();
  wm = WM.create({ root: p.q('wmBody'), video: () => video, onChange: estimate });

  makePicker(p.q('pick'), { kind:'video', onFile: load });

  p.q('wmOn').onchange = e => {
    p.q('wmBody').classList.toggle('hide', !e.target.checked);
    if (e.target.checked) wm.init();
    estimate();
  };
  ['fps','maxw','start','end'].forEach(k => p.q(k).oninput = estimate);
  p.q('quality').oninput = () => { p.q('qval').textContent = p.q('quality').value; estimate(); };
  p.q('another').onclick = () => { p.step(null); p.q('body').classList.add('hide'); p.q('pick').classList.remove('hide'); };
  p.q('again').onclick   = () => { p.step('body'); };
  p.q('cancel').onclick  = () => { cancelled = true; };
  p.q('save').onclick    = () => download(zipBlob, baseName(file.name) + '_frames.zip');

  function load(f){
    file = f;
    p.clearErr();
    if (srcURL) URL.revokeObjectURL(srcURL);
    srcURL = URL.createObjectURL(f);
    video.src = srcURL;
    video.onloadedmetadata = () => {
      if (!isFinite(video.duration) || !video.duration)
        return p.fail('Could not read this video\'s duration. Try re-encoding it as MP4 (H.264).');
      p.q('end').value = video.duration.toFixed(2);
      p.q('info').innerHTML =
        '<span>File <b>' + escapeHtml(f.name) + '</b></span>' +
        '<span>Size <b>' + fmtBytes(f.size) + '</b></span>' +
        '<span>Duration <b>' + video.duration.toFixed(2) + 's</b></span>' +
        '<span>Resolution <b>' + video.videoWidth + '×' + video.videoHeight + '</b></span>';
      p.q('pick').classList.add('hide');
      p.step('body');
      wm.reset();
      if (p.q('wmOn').checked) wm.init();
      estimate();
    };
    video.onerror = () => p.fail('Your browser cannot decode this video format. MP4 (H.264) and WebM are the safest bets.');
  }

  function plan(){
    const fps   = Math.max(0.1, +p.q('fps').value || 30);
    const start = Math.max(0, +p.q('start').value || 0);
    const end   = Math.min(video.duration, (+p.q('end').value > 0 ? +p.q('end').value : video.duration));
    const span  = Math.max(0, end - start);
    const count = Math.max(0, Math.floor(span * fps));
    const maxw  = Math.max(0, +p.q('maxw').value || 0);
    let w = video.videoWidth || 1, h = video.videoHeight || 1;
    if (maxw > 0 && w > maxw){ h = Math.round(h * maxw / w); w = maxw; }

    const wmOn = p.q('wmOn').checked && wm.hasBoxes();
    let crop = null, cw = w, ch = h;
    if (wmOn && wm.mode === 'crop'){ crop = wm.cropRect(w,h); cw = crop.w; ch = crop.h; }
    return { fps, start, count, w, h, cw, ch, crop, wmOn, quality:(+p.q('quality').value)/100 };
  }

  function estimate(){
    if (!video.videoWidth) return;
    const pl = plan(), est = p.q('estimate');
    if (!pl.count){ est.className = 'note'; est.textContent = 'Nothing to extract — check the start/end times.'; return; }
    const kb = pl.cw * pl.ch * 0.09 * (0.4 + pl.quality*0.9) / 1024;
    const mb = kb * pl.count / 1024;
    const secs = Math.round(pl.count / 14 * (pl.wmOn && wm.mode !== 'crop' ? 1.6 : 1));
    const heavy = pl.count > 6000;
    est.className = 'note' + (heavy ? '' : ' ok');
    est.innerHTML = '<b>' + pl.count.toLocaleString() + '</b> JPEGs at <b>' + pl.cw + '×' + pl.ch + '</b>' +
      (pl.crop ? ' <span style="opacity:.7">(cropped from ' + pl.w + '×' + pl.h + ')</span>' : '') +
      ' · ≈ <b>' + (mb < 1024 ? mb.toFixed(0) + ' MB' : (mb/1024).toFixed(1) + ' GB') + '</b> ZIP · roughly <b>' +
      fmtTime(secs) + '</b> to process' +
      (pl.wmOn ? ' <span style="opacity:.7">· watermark: ' + wm.mode + '</span>' : '') +
      (heavy ? '<br>⚠ That is a lot of frames — consider a shorter range, lower fps, or a smaller max width.' : '');
  }

  p.q('go').onclick = async () => {
    const pl = plan();
    if (!pl.count) return;
    cancelled = false;
    p.clearErr();
    p.step('job');

    const canvas = document.createElement('canvas');
    canvas.width = pl.w; canvas.height = pl.h;
    const ctx = canvas.getContext('2d', { alpha:false });

    const doCrop = !!(pl.crop && (pl.cw !== pl.w || pl.ch !== pl.h));
    const out = doCrop ? document.createElement('canvas') : canvas;
    let octx = ctx;
    if (doCrop){ out.width = pl.cw; out.height = pl.ch; octx = out.getContext('2d', { alpha:false }); }

    const prev = p.q('prev');
    prev.width = pl.cw; prev.height = pl.ch;
    const pctx = prev.getContext('2d', { alpha:false });

    const pad = Math.max(5, String(pl.count).length);
    const entries = [];
    const t0 = performance.now();

    try {
      video.pause();
      for (let i = 0; i < pl.count; i++){
        if (cancelled) break;
        await seek(video, pl.start + i/pl.fps);
        ctx.drawImage(video, 0, 0, pl.w, pl.h);
        if (pl.wmOn) wm.apply(ctx, pl.w, pl.h);
        if (doCrop) octx.drawImage(canvas, -pl.crop.x, -pl.crop.y);

        const blob = await new Promise(r => out.toBlob(r, 'image/jpeg', pl.quality));
        if (!blob) throw new Error('JPEG encoding failed (the canvas may be blocked).');
        const bytes = new Uint8Array(await blob.arrayBuffer());
        entries.push({ name:'frame_' + String(i+1).padStart(pad,'0') + '.jpg', blob, crc:crc32(bytes), size:bytes.length });

        if (i % 3 === 0 || i === pl.count-1){
          pctx.drawImage(out, 0, 0);
          const pc = (i+1)/pl.count;
          p.prog(pc);
          p.stat('Frame ' + (i+1) + ' of ' + pl.count + ' — ' + (pc*100).toFixed(1) + '%');
          const elapsed = (performance.now()-t0)/1000;
          p.eta(i > 4 ? '~' + fmtTime(elapsed/pc - elapsed) + ' left' : '');
          await idle();
        }
      }
      if (!entries.length) throw new Error('No frames were captured.');

      p.stat('Packing ' + entries.length + ' files into a ZIP…');
      p.eta('');
      await idle();
      zipBlob = buildZip(entries);
      p.step('done');
      p.q('msg').innerHTML = '✅ <b>' + entries.length.toLocaleString() + '</b> JPEGs ready — <b>' +
        fmtBytes(zipBlob.size) + '</b>' + (cancelled ? ' (cancelled early)' : '') + '.';
    } catch(e){ p.fail(e.message); }
  };
})();

/* ================= 2. REMOVE WATERMARK -> VIDEO ================= */
(function toolWmVideo(){
  const p = P('wmvideo');
  let file = null, outBlob = null, wm = null, srcURL = null;
  const video = p.q('video');

  p.q('wmBody').innerHTML = WM.markup();
  wm = WM.create({ root: p.q('wmBody'), video: () => video, onChange: estimate });

  makePicker(p.q('pick'), { kind:'video', onFile: load });

  p.q('crf').oninput = () => { p.q('crfval').textContent = p.q('crf').value; estimate(); };
  p.q('preset').onchange = estimate;
  p.q('audio').onchange = estimate;
  p.q('another').onclick = () => { p.q('body').classList.add('hide'); p.q('pick').classList.remove('hide'); };
  p.q('again').onclick = () => p.step('body');
  p.q('save').onclick = () => download(outBlob, baseName(file.name) + '_nowatermark.mp4');

  function load(f){
    file = f;
    p.clearErr();
    if (srcURL) URL.revokeObjectURL(srcURL);
    srcURL = URL.createObjectURL(f);
    video.src = srcURL;
    video.onloadedmetadata = () => {
      p.q('info').innerHTML =
        '<span>File <b>' + escapeHtml(f.name) + '</b></span>' +
        '<span>Size <b>' + fmtBytes(f.size) + '</b></span>' +
        '<span>Duration <b>' + video.duration.toFixed(2) + 's</b></span>' +
        '<span>Resolution <b>' + video.videoWidth + '×' + video.videoHeight + '</b></span>';
      p.q('pick').classList.add('hide');
      p.step('body');
      wm.reset(); wm.init();
      estimate();
    };
    video.onerror = () => p.fail('Your browser cannot decode this video format.');
  }

  function estimate(){
    const est = p.q('estimate');
    if (!wm.hasBoxes()){
      est.className = 'note';
      est.innerHTML = 'Draw at least one box around the watermark to continue.';
      p.q('go').disabled = true;
      return;
    }
    p.q('go').disabled = false;
    const secs = Math.round((video.duration || 0) * 0.8);
    est.className = 'note ok';
    est.innerHTML = 'Method <b>' + wm.mode + '</b> on <b>' + wm.boxes.length + '</b> box' +
      (wm.boxes.length > 1 ? 'es' : '') + ' · re-encodes the video, roughly <b>' + fmtTime(secs) +
      '</b>' + (ENV.mt ? ' (multithreaded)' : ' (single-threaded).' + speedTip()) + '.' +
      (wm.mode === 'crop' ? '' : '<br>The audio is ' + (p.q('audio').value === 'copy' ? 'kept exactly as it is.' : 'dropped.'));
  }

  p.q('go').onclick = async () => {
    if (!wm.hasBoxes()) return;
    p.clearErr(); p.clearLog(); p.step('job'); p.prog(0);

    const W = video.videoWidth, H = video.videoHeight;
    const chain = wm.filterChain(W, H);
    if (!chain) return p.fail('Those boxes are too small to process.');

    const inName = 'in.' + extOf(file.name);
    const keepAudio = p.q('audio').value === 'copy';
    const vArgs = ['-c:v','libx264','-crf', p.q('crf').value, '-preset', p.q('preset').value, '-pix_fmt','yuv420p'];

    let args;
    if (typeof chain === 'string'){
      args = ['-i', inName, '-vf', chain, ...vArgs];
      if (keepAudio) args.push('-c:a','copy'); else args.push('-an');
    } else {
      args = ['-i', inName, '-filter_complex', chain.complex, '-map', chain.out, ...vArgs];
      if (keepAudio) args.push('-map','0:a?','-c:a','copy'); else args.push('-an');
    }
    args.push('-movflags','+faststart','out.mp4');

    // if stream-copying the audio into MP4 fails (e.g. Opus source), re-encode it
    const fb = keepAudio ? {
      why: 'the original audio codec does not fit in an MP4, re-encoding it to AAC',
      args: args.map(a => a === 'copy' ? 'aac' : a)
    } : null;

    try {
      p.stat('Loading the ffmpeg engine…');
      const res = await ffRun(p, args, [{ name:inName, data:file }], 'out.mp4', 'Removing watermark', fb);
      outBlob = new Blob([res.data.buffer], { type:'video/mp4' });
      p.step('done');
      p.q('result').src = URL.createObjectURL(outBlob);
      p.q('msg').innerHTML = '✅ Watermark removed with <b>' + wm.mode + '</b> — <b>' + fmtBytes(outBlob.size) +
        '</b> MP4' + (keepAudio ? ' with the original audio.' : ', no audio.');
    } catch(e){
      p.fail(e.message + (wm.mode === 'inpaint'
        ? '\n\nIf the delogo filter is unavailable in this build, switch the method to Blur, Pixelate or Crop.' : ''));
    }
  };
})();

/* ================= 3. EXTRACT AUDIO ================= */
(function toolExtract(){
  const p = P('extract');
  let file = null, buf = null, outBlob = null, outName = 'audio.wav', srcURL = null;

  const FMT_HINT = {
    wav : 'Decoded in your browser — no engine download, works offline, perfect quality.',
    mp3 : 'Re-encoded with ffmpeg. Universally playable.',
    m4a : 'Re-encoded with ffmpeg. Better quality than MP3 at the same size.',
    copy: 'No re-encoding at all — the original audio stream is lifted straight out.',
  };

  makePicker(p.q('pick'), { kind:'media', onFile: load, icon:'🎬',
    label:'Drag &amp; drop a video (or audio) file',
    sub:'MP4, MOV, MKV, WebM — or an audio file you want to convert' });

  p.q('format').onchange = () => {
    const f = p.q('format').value;
    p.q('fmthint').textContent = FMT_HINT[f];
    p.q('bitrate').disabled = f === 'wav' || f === 'copy';
    p.q('channels').disabled = f === 'copy';
  };
  p.q('format').onchange();
  p.q('another').onclick = () => { p.q('body').classList.add('hide'); p.q('pick').classList.remove('hide'); };
  p.q('again').onclick = () => p.step('body');
  p.q('save').onclick = () => download(outBlob, outName);

  async function load(f){
    file = f; buf = null;
    p.clearErr();
    p.q('pick').classList.add('hide');
    p.step('body');
    p.q('info').innerHTML = '<span>File <b>' + escapeHtml(f.name) + '</b></span><span>Size <b>' +
      fmtBytes(f.size) + '</b></span><span>Reading the audio…</span>';
    if (srcURL) URL.revokeObjectURL(srcURL);
    srcURL = URL.createObjectURL(f);
    p.q('player').src = srcURL;

    try {
      buf = await decodeAudio(f);
      p.q('info').innerHTML =
        '<span>File <b>' + escapeHtml(f.name) + '</b></span>' +
        '<span>Size <b>' + fmtBytes(f.size) + '</b></span>' +
        '<span>Audio <b>' + buf.duration.toFixed(2) + 's</b></span>' +
        '<span>Sample rate <b>' + buf.sampleRate + ' Hz</b></span>' +
        '<span>Channels <b>' + buf.numberOfChannels + '</b></span>';
      drawWave(p.q('wave'), buf.getChannelData(0), buf.duration);
    } catch(e){
      p.q('info').innerHTML = '<span>File <b>' + escapeHtml(f.name) + '</b></span><span>Size <b>' +
        fmtBytes(f.size) + '</b></span>';
      p.q('wave').classList.add('hide');
      if (p.q('format').value === 'wav') p.q('format').value = 'm4a', p.q('format').onchange();
      p.fail('The browser could not decode this file\'s audio directly, so WAV export is unavailable. ' +
             'MP3, M4A and "original stream" still work — they go through ffmpeg.');
    }
  }

  p.q('go').onclick = async () => {
    const fmt = p.q('format').value;
    const mono = p.q('channels').value === 'mono';
    p.clearErr(); p.clearLog(); p.step('job'); p.prog(0);

    try {
      if (fmt === 'wav'){
        if (!buf) throw new Error('This file\'s audio could not be decoded in the browser — pick MP3 or M4A instead.');
        p.stat('Writing WAV…');
        await idle();
        let chans = bufferToChannels(buf);
        if (mono && chans.length > 1){
          const m = new Float32Array(chans[0].length);
          for (let i = 0; i < m.length; i++){
            let s = 0;
            for (let c = 0; c < chans.length; c++) s += chans[c][i];
            m[i] = s / chans.length;
          }
          chans = [m];
        }
        p.prog(0.6);
        outBlob = encodeWAV(chans, buf.sampleRate);
        outName = baseName(file.name) + '.wav';
      } else {
        const inName = 'in.' + extOf(file.name);
        let args, out;
        if (fmt === 'copy'){
          const e = extOf(file.name);
          const container = /mp4|mov|m4v|3gp|m4a/.test(e) ? 'm4a' : /webm|ogg|opus/.test(e) ? 'webm' : 'mka';
          out = 'out.' + container;
          args = ['-i', inName, '-vn', '-c:a', 'copy', out];
        } else {
          out = 'out.' + fmt;
          const codec = fmt === 'mp3' ? 'libmp3lame' : 'aac';
          args = ['-i', inName, '-vn', '-c:a', codec, '-b:a', p.q('bitrate').value];
          if (mono) args.push('-ac','1');
          args.push(out);
        }
        p.stat('Loading the ffmpeg engine…');
        const fb = fmt === 'copy' ? {
          why: 'that stream cannot be copied into a standalone file, re-encoding to M4A instead',
          args: ['-i', inName, '-vn', '-c:a', 'aac', '-b:a', '192k', 'out.m4a'],
          out: 'out.m4a'
        } : null;
        const res = await ffRun(p, args, [{ name:inName, data:file }], out, 'Extracting audio', fb);
        const ext = res.out.split('.').pop();          // the fallback may have written a different container
        const mime = ext === 'mp3' ? 'audio/mpeg' : ext === 'wav' ? 'audio/wav'
                   : ext === 'webm' ? 'audio/webm' : ext === 'mka' ? 'audio/x-matroska' : 'audio/mp4';
        outBlob = new Blob([res.data.buffer], { type: mime });
        outName = baseName(file.name) + '.' + ext;
      }

      p.step('done');
      p.q('result').src = URL.createObjectURL(outBlob);
      p.q('msg').innerHTML = '✅ Audio extracted — <b>' + escapeHtml(outName) + '</b>, <b>' + fmtBytes(outBlob.size) + '</b>.';
    } catch(e){ p.fail(e.message); }
  };
})();

/* ================= 4. MUTE ================= */
(function toolMute(){
  const p = P('mute');
  let file = null, outBlob = null, outName = 'muted.mp4', srcURL = null;
  const video = p.q('video');

  makePicker(p.q('pick'), { kind:'video', onFile: load });

  p.q('mode').onchange = () => {
    p.q('modehint').textContent = p.q('mode').value === 'remove'
      ? 'The file simply has no audio track. Smallest result.'
      : 'Keeps a silent track — safer for editors and players that expect one.';
  };
  p.q('mode').onchange();
  p.q('another').onclick = () => { p.q('body').classList.add('hide'); p.q('pick').classList.remove('hide'); };
  p.q('again').onclick = () => p.step('body');
  p.q('save').onclick = () => download(outBlob, outName);

  function load(f){
    file = f;
    p.clearErr();
    if (srcURL) URL.revokeObjectURL(srcURL);
    srcURL = URL.createObjectURL(f);
    video.src = srcURL;
    video.onloadedmetadata = () => {
      p.q('info').innerHTML =
        '<span>File <b>' + escapeHtml(f.name) + '</b></span>' +
        '<span>Size <b>' + fmtBytes(f.size) + '</b></span>' +
        '<span>Duration <b>' + video.duration.toFixed(2) + 's</b></span>' +
        '<span>Resolution <b>' + video.videoWidth + '×' + video.videoHeight + '</b></span>';
      p.q('pick').classList.add('hide');
      p.step('body');
    };
    video.onerror = () => p.fail('Your browser cannot preview this format, but ffmpeg may still handle it — try anyway.');
  }

  p.q('go').onclick = async () => {
    p.clearErr(); p.clearLog(); p.step('job'); p.prog(0);
    const inExt = extOf(file.name);
    const want = p.q('container').value;
    const ext = want === 'same' ? inExt : want;
    const out = 'out.' + ext;
    const inName = 'in.' + inExt;

    const args = p.q('mode').value === 'remove'
      ? ['-i', inName, '-c', 'copy', '-an', out]
      : ['-i', inName, '-f','lavfi','-i','anullsrc=channel_layout=stereo:sample_rate=44100',
         '-map','0:v','-map','1:a','-c:v','copy','-c:a', ext === 'webm' ? 'libopus' : 'aac','-shortest', out];

    // stream-copy can fail when changing container; fall back to a re-encode
    const fb = {
      why: 'the video stream cannot be copied into that container, re-encoding the video',
      args: p.q('mode').value === 'remove'
        ? ['-i', inName, '-c:v', ext === 'webm' ? 'libvpx' : 'libx264', '-crf','20','-preset','faster','-an', out]
        : ['-i', inName, '-f','lavfi','-i','anullsrc=channel_layout=stereo:sample_rate=44100',
           '-map','0:v','-map','1:a','-c:v', ext === 'webm' ? 'libvpx' : 'libx264','-crf','20','-preset','faster',
           '-c:a', ext === 'webm' ? 'libopus' : 'aac','-shortest', out]
    };

    try {
      p.stat('Loading the ffmpeg engine…');
      const res = await ffRun(p, args, [{ name:inName, data:file }], out, 'Muting', fb);
      outBlob = new Blob([res.data.buffer], { type: ext === 'webm' ? 'video/webm' : 'video/mp4' });
      outName = baseName(file.name) + '_muted.' + ext;
      p.step('done');
      p.q('result').src = URL.createObjectURL(outBlob);
      p.q('msg').innerHTML = '✅ Muted — <b>' + fmtBytes(outBlob.size) + '</b>. The picture was copied bit-for-bit, so there is no quality loss.';
    } catch(e){ p.fail(e.message); }
  };
})();

/* ================= 5. MERGE AUDIO + VIDEO ================= */
(function toolMerge(){
  const p = P('merge');
  let vFile = null, aFile = null, outBlob = null, outName = 'merged.mp4', vDur = 0;

  makePicker(p.q('pickV'), { kind:'video', onFile: f => {
    vFile = f;
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      vDur = v.duration;
      p.q('infoV').innerHTML = '<span>Video <b>' + escapeHtml(f.name) + '</b></span><span>Size <b>' +
        fmtBytes(f.size) + '</b></span><span>Duration <b>' + v.duration.toFixed(2) + 's</b></span>';
      ready();
    };
    v.onerror = () => { p.q('infoV').innerHTML = '<span>Video <b>' + escapeHtml(f.name) + '</b></span>'; ready(); };
    v.src = URL.createObjectURL(f);
  }});

  makePicker(p.q('pickA'), { kind:'audio', onFile: f => {
    aFile = f;
    const a = document.createElement('audio');
    a.preload = 'metadata';
    a.onloadedmetadata = () => {
      p.q('infoA').innerHTML = '<span>Audio <b>' + escapeHtml(f.name) + '</b></span><span>Size <b>' +
        fmtBytes(f.size) + '</b></span><span>Duration <b>' + a.duration.toFixed(2) + 's</b></span>';
      ready();
    };
    a.onerror = () => { p.q('infoA').innerHTML = '<span>Audio <b>' + escapeHtml(f.name) + '</b></span>'; ready(); };
    a.src = URL.createObjectURL(f);
  }});

  function ready(){ if (vFile && aFile) p.step('body'); }

  p.q('mode').onchange = () => {
    const mix = p.q('mode').value === 'mix';
    p.q('vol2').disabled = !mix;
    p.q('modehint').textContent = mix
      ? 'Both tracks play together — good for adding music under existing speech.'
      : 'The original soundtrack is discarded.';
  };
  p.q('mode').onchange();
  p.q('vol1').oninput = () => p.q('v1val').textContent = p.q('vol1').value;
  p.q('vol2').oninput = () => p.q('v2val').textContent = p.q('vol2').value;
  p.q('another').onclick = () => location.reload();
  p.q('again').onclick = () => p.step('body');
  p.q('save').onclick = () => download(outBlob, outName);

  p.q('go').onclick = async () => {
    if (!vFile || !aFile) return;
    p.clearErr(); p.clearLog(); p.step('job'); p.prog(0);

    const vIn = 'v.' + extOf(vFile.name), aIn = 'a.' + extOf(aFile.name);
    const v1 = (+p.q('vol1').value)/100, v2 = (+p.q('vol2').value)/100;
    const mix = p.q('mode').value === 'mix';
    const matchVideo = p.q('len').value === 'video';

    let args;
    if (mix){
      const fc = '[0:a]volume=' + v2 + '[a0];[1:a]volume=' + v1 + '[a1];' +
                 '[a0][a1]amix=inputs=2:duration=' + (matchVideo ? 'first' : 'shortest') + ':dropout_transition=0[aout]';
      args = ['-i', vIn, '-i', aIn, '-filter_complex', fc, '-map','0:v','-map','[aout]',
              '-c:v','copy','-c:a','aac','-b:a','192k'];
    } else {
      args = ['-i', vIn, '-i', aIn, '-map','0:v','-map','1:a','-c:v','copy','-c:a','aac','-b:a','192k'];
      if (v1 !== 1) args.push('-af','volume=' + v1);
      if (matchVideo) args.push('-af','apad');
    }
    if (matchVideo && vDur) args.push('-t', vDur.toFixed(3));
    else args.push('-shortest');
    args.push('-movflags','+faststart','out.mp4');

    // "mix" needs the video to actually have audio — if it does not, fall back to replace
    const fb = mix ? {
      why: 'the video has no audio to mix with, using the new track on its own',
      args: ['-i', vIn, '-i', aIn, '-map','0:v','-map','1:a','-c:v','copy','-c:a','aac','-b:a','192k',
             '-shortest','-movflags','+faststart','out.mp4']
    } : {
      why: 'the video stream could not be copied, re-encoding it',
      args: ['-i', vIn, '-i', aIn, '-map','0:v','-map','1:a','-c:v','libx264','-crf','20','-preset','faster',
             '-c:a','aac','-b:a','192k','-shortest','-movflags','+faststart','out.mp4']
    };

    try {
      p.stat('Loading the ffmpeg engine…');
      const res = await ffRun(p, args, [{ name:vIn, data:vFile }, { name:aIn, data:aFile }], 'out.mp4', 'Merging', fb);
      outBlob = new Blob([res.data.buffer], { type:'video/mp4' });
      outName = baseName(vFile.name) + '_with_audio.mp4';
      p.step('done');
      p.q('result').src = URL.createObjectURL(outBlob);
      p.q('msg').innerHTML = '✅ Merged — <b>' + fmtBytes(outBlob.size) + '</b>. ' +
        (mix ? 'Both soundtracks are mixed together.' : 'The new soundtrack replaced the original.');
    } catch(e){ p.fail(e.message); }
  };
})();

/* ================= 6. NOISE CANCELLATION ================= */
(function toolDenoise(){
  const p = P('denoise');
  let file = null, buf = null, isVideo = false, outBlob = null, outName = 'clean.wav';
  let wavBlob = null, sel = null, srcURL = null;

  makePicker(p.q('pick'), { kind:'media', icon:'🎧', onFile: load,
    label:'Drag &amp; drop an audio or video file',
    sub:'MP3, WAV, M4A, FLAC — or a video whose soundtrack needs cleaning' });

  p.q('amount').oninput = () => p.q('amtval').textContent = p.q('amount').value;
  p.q('clearsel').onclick = () => { sel = null; redraw(); };
  p.q('another').onclick = () => { p.q('body').classList.add('hide'); p.q('pick').classList.remove('hide'); };
  p.q('again').onclick = () => p.step('body');
  p.q('save').onclick = () => download(outBlob, outName);

  async function load(f){
    file = f;
    sel = null;
    isVideo = VIDEO_RE.test(f.name) || f.type.startsWith('video/');
    p.clearErr();
    p.q('pick').classList.add('hide');
    p.step('body');
    p.q('info').innerHTML = '<span>File <b>' + escapeHtml(f.name) + '</b></span><span>Reading audio…</span>';
    if (srcURL) URL.revokeObjectURL(srcURL);
    srcURL = URL.createObjectURL(f);

    try {
      buf = await decodeAudio(f);
    } catch(e){
      // some containers will not decode directly — pull the audio out with ffmpeg first
      try {
        p.q('info').innerHTML = '<span>Decoding with ffmpeg…</span>';
        const data = await FF.run(['-i','in.' + extOf(f.name), '-vn','-c:a','pcm_s16le','out.wav'],
                                  [{ name:'in.' + extOf(f.name), data:f }], 'out.wav',
                                  { onStatus:m => p.q('info').innerHTML = '<span>' + escapeHtml(m) + '</span>' });
        buf = await decodeAudio(data.buffer);
      } catch(e2){ return p.fail('Could not read any audio from this file.\n' + e2.message); }
    }

    p.q('info').innerHTML =
      '<span>File <b>' + escapeHtml(f.name) + '</b></span>' +
      '<span>Size <b>' + fmtBytes(f.size) + '</b></span>' +
      '<span>Audio <b>' + buf.duration.toFixed(2) + 's</b></span>' +
      '<span>Rate <b>' + buf.sampleRate + ' Hz</b></span>' +
      '<span>Channels <b>' + buf.numberOfChannels + '</b></span>' +
      '<span>Noise floor <b>' + D.rmsDb(quietest(buf.getChannelData(0))).toFixed(1) + ' dBFS</b></span>';
    redraw();
  }

  /* roughly the quietest half-second, used to report the noise floor */
  function quietest(ch){
    const win = Math.min(ch.length, Math.floor(buf.sampleRate * 0.5));
    let best = 0, bestE = Infinity;
    for (let s = 0; s + win <= ch.length; s += win){
      let e = 0;
      for (let i = s; i < s+win; i++) e += ch[i]*ch[i];
      if (e < bestE){ bestE = e; best = s; }
    }
    return ch.subarray(best, best+win);
  }

  function redraw(){
    if (!buf) return;
    drawWave(p.q('wave'), buf.getChannelData(0), buf.duration, sel);
    p.q('selinfo').textContent = sel
      ? 'Learning the noise from ' + sel[0].toFixed(2) + 's → ' + sel[1].toFixed(2) + 's.'
      : 'No selection — the noise profile will be learned automatically.';
  }

  /* drag on the waveform to mark a noise-only stretch */
  (function selection(){
    const cv = p.q('wave');
    let start = null;
    const at = e => {
      const r = cv.getBoundingClientRect();
      const px = ((e.touches ? e.touches[0] : e).clientX - r.left) / r.width;
      return Math.max(0, Math.min(1, px)) * buf.duration;
    };
    const down = e => { if (!buf) return; e.preventDefault(); start = at(e); sel = [start, start]; redraw(); };
    const move = e => { if (start == null || !buf) return; const t = at(e); sel = [Math.min(start,t), Math.max(start,t)]; redraw(); };
    const up   = () => { if (start == null) return; start = null; if (sel && sel[1]-sel[0] < 0.05) sel = null; redraw(); };
    cv.addEventListener('mousedown', down);
    cv.addEventListener('touchstart', down, { passive:false });
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive:false });
    window.addEventListener('mouseup', up);
    window.addEventListener('touchend', up);
  })();

  /* Run the denoiser off the main thread so the UI keeps painting.
     The worker is built from a Blob so it works on file:// too. */
  function denoiseWorker(){
    const src =
      'const fft=' + D.fft.toString() + ';\n' +
      'const hann=' + D.hann.toString() + ';\n' +
      'const denoise=' + D.denoise.toString() + ';\n' +
      'const highPass=' + D.highPass.toString() + ';\n' +
      'const normalize=' + D.normalize.toString() + ';\n' +
      'onmessage = e => {\n' +
      '  const {channels, sampleRate, amount, hp, norm} = e.data;\n' +
      '  const out = [];\n' +
      '  for (let c = 0; c < channels.length; c++){\n' +
      '    let x = channels[c];\n' +
      '    if (hp) x = highPass(x, sampleRate, hp);\n' +
      '    x = denoise(x, { amount, noiseFrom: e.data.noiseFrom,\n' +
      '        onProgress: v => postMessage({ progress:(c+v)/channels.length }) });\n' +
      '    if (norm) x = normalize(x, 0.95);\n' +
      '    out.push(x);\n' +
      '  }\n' +
      '  postMessage({ done:true, out }, out.map(a => a.buffer));\n' +
      '};';
    return new Worker(URL.createObjectURL(new Blob([src], { type:'text/javascript' })));
  }

  function runDenoise(channels, sampleRate, opts, onProgress){
    return new Promise((resolve, reject) => {
      let w;
      try { w = denoiseWorker(); }
      catch(_){                                        // workers unavailable — do it inline
        try {
          const out = channels.map(ch => {
            let x = ch;
            if (opts.hp) x = D.highPass(x, sampleRate, opts.hp);
            x = D.denoise(x, { amount:opts.amount, noiseFrom:opts.noiseFrom });
            return opts.norm ? D.normalize(x, 0.95) : x;
          });
          return resolve(out);
        } catch(e){ return reject(e); }
      }
      w.onmessage = e => {
        if (e.data.progress != null) onProgress(e.data.progress);
        if (e.data.done){ w.terminate(); resolve(e.data.out.map(a => new Float32Array(a))); }
      };
      w.onerror = err => { w.terminate(); reject(new Error(err.message || 'denoiser failed')); };
      const copies = channels.map(c => new Float32Array(c));
      w.postMessage({ channels:copies, sampleRate, amount:opts.amount, hp:opts.hp,
                      norm:opts.norm, noiseFrom:opts.noiseFrom }, copies.map(c => c.buffer));
    });
  }

  p.q('go').onclick = async () => {
    if (!buf) return;
    p.clearErr(); p.clearLog(); p.step('job'); p.prog(0);

    try {
      const sr = buf.sampleRate;
      const channels = bufferToChannels(buf);
      const noiseFrom = sel ? [Math.floor(sel[0]*sr), Math.floor(sel[1]*sr)] : null;

      p.stat('Analysing and cleaning the audio…');
      const t0 = performance.now();
      const cleaned = await runDenoise(channels, sr, {
        amount: (+p.q('amount').value)/100,
        hp: +p.q('hp').value,
        norm: p.q('norm').value === '1',
        noiseFrom
      }, v => { p.prog(v*0.85); p.stat('Cleaning the audio — ' + (v*100).toFixed(0) + '%'); });

      const before = D.rmsDb(quietest(channels[0]));
      const after  = D.rmsDb(cleaned[0].subarray(0, Math.min(cleaned[0].length, sr)));
      p.prog(0.9);
      p.stat('Writing the file…');
      await idle();

      wavBlob = encodeWAV(cleaned, sr);
      outBlob = wavBlob;
      outName = baseName(file.name) + '_clean.wav';

      let extra = '';
      if (isVideo){
        try {
          p.stat('Putting the cleaned audio back into the video…');
          const vIn = 'v.' + extOf(file.name);
          const data = await FF.run(
            ['-i', vIn, '-i', 'clean.wav', '-map','0:v','-map','1:a','-c:v','copy','-c:a','aac','-b:a','192k',
             '-shortest','-movflags','+faststart','out.mp4'],
            [{ name:vIn, data:file }, { name:'clean.wav', data:wavBlob }],
            'out.mp4', hooks(p, 'Rebuilding the video'));
          outBlob = new Blob([data.buffer], { type:'video/mp4' });
          outName = baseName(file.name) + '_clean.mp4';
          extra = ' The cleaned soundtrack was put back into the video.';
        } catch(e){
          extra = ' (Could not rebuild the video — ' + e.message + ' — so you get the cleaned audio as WAV.)';
        }
      }

      p.prog(1);
      p.step('done');
      p.q('before').src = srcURL;
      p.q('after').src  = URL.createObjectURL(wavBlob);
      drawWave(p.q('waveAfter'), cleaned[0], buf.duration);
      p.q('msg').innerHTML = '✅ Noise floor <b>' + before.toFixed(1) + ' dB</b> → <b>' + after.toFixed(1) +
        ' dB</b> — a <b>' + Math.max(0, before-after).toFixed(1) + ' dB</b> reduction, in ' +
        ((performance.now()-t0)/1000).toFixed(1) + 's.' + extra;

      // when the result is a video, offer the audio-only file as a second download
      let alt = p.root.querySelector('[data-el=alt]');
      if (isVideo && outBlob !== wavBlob){
        if (!alt){
          alt = el('button','ghost');
          alt.dataset.el = 'alt';
          p.q('save').parentNode.insertBefore(alt, p.q('again'));
        }
        alt.textContent = '⬇ Audio only (WAV)';
        alt.onclick = () => download(wavBlob, baseName(file.name) + '_clean.wav');
        alt.classList.remove('hide');
        p.q('save').textContent = '⬇ Download video';
      } else if (alt){
        alt.classList.add('hide');
        p.q('save').textContent = '⬇ Download';
      }
    } catch(e){ p.fail(e.message); }
  };
})();

/* ================= environment note ================= */
(function env(){
  const n = document.getElementById('envNote');
  if (ENV.hosted){
    n.innerHTML = ENV.mt
      ? '⚡ <b>Running at full speed.</b> This page is cross-origin isolated, so ffmpeg uses multiple threads. ' +
        'Your files are processed in this browser and never uploaded.'
      : '📦 Everything works, but ffmpeg is single-threaded here — video jobs will be slower. ' +
        'Your files are still processed entirely in this browser and never uploaded.';
  } else if (ENV.isLocal){
    n.innerHTML = ENV.mt
      ? '⚡ <b>Running at full speed.</b> ffmpeg will use multiple threads, and the engine loads from your local <code>vendor/</code> folder — no internet needed.'
      : '📦 Served locally, but multithreading is off. Restart with <code>start.bat</code> to get the COOP/COEP headers that enable it.';
  } else {
    n.innerHTML = '💡 <b>Tip:</b> you opened this file directly. The frame, audio and noise tools work fine, but the ' +
      'ffmpeg-based tools will fetch the engine from the internet each session. Run <code>start.bat</code> instead ' +
      'to use the offline copy and go several times faster.';
  }
})();

/* open straight into a tool if the URL has a hash */
(function initial(){
  const h = location.hash.replace('#','');
  if (h && document.getElementById('panel-' + h)) show(h); else show('');
})();

})();
