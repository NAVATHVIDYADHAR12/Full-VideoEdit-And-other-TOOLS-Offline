/* nle-render.js — media handling, frame compositing, audio mixdown and export
 * for the timeline editor.
 *
 * Preview and export deliberately share one compositor. Preview lets the video
 * elements run and paints whatever frame they are showing; export seeks each
 * source to an exact time first, so the result is deterministic and does not
 * depend on how fast the machine is.
 */
(function (root) {
'use strict';

const C = root.Core, N = root.Nle;
const { idle, encodeWAV } = C;

/* ================= media import ================= */
const kindOf = file => {
  const t = file.type || '';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  if (t.startsWith('image/')) return 'image';
  const e = (file.name.match(/\.([^.]+)$/) || [,''])[1].toLowerCase();
  if (/^(mp4|webm|mov|mkv|avi|m4v|ts)$/.test(e)) return 'video';
  if (/^(mp3|wav|m4a|aac|ogg|opus|flac)$/.test(e)) return 'audio';
  if (/^(jpe?g|png|gif|bmp|webp|avif)$/.test(e)) return 'image';
  return null;
};

async function importFile(project, file, onNote){
  const kind = kindOf(file);
  if (!kind) throw new Error(file.name + ' is not a video, audio or image file.');
  const url = URL.createObjectURL(file);

  const media = { name:file.name, kind, file, url, duration:0, width:0, height:0,
                  audio:null, hasAudio:false, pool:{} };

  if (kind === 'image'){
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Could not read ' + file.name)); img.src = url; });
    media.el = img;
    media.width = img.naturalWidth;
    media.height = img.naturalHeight;
    media.duration = 5;
  } else {
    const el = document.createElement(kind === 'video' ? 'video' : 'audio');
    el.src = url;
    el.preload = 'auto';
    if (kind === 'video'){ el.muted = true; el.playsInline = true; }
    await new Promise((res, rej) => {
      el.onloadedmetadata = res;
      el.onerror = () => rej(new Error('Your browser cannot decode ' + file.name));
    });
    if (!isFinite(el.duration) || !el.duration)
      throw new Error('Could not read the duration of ' + file.name);
    media.el = el;
    media.duration = el.duration;
    media.width = el.videoWidth || 0;
    media.height = el.videoHeight || 0;

    try {
      media.audio = await C.decodeAudio(file);
      media.hasAudio = media.audio.numberOfChannels > 0 && media.audio.length > 0;
    } catch(_){
      media.hasAudio = false;
      if (kind === 'audio') throw new Error('Could not decode the audio in ' + file.name);
      if (onNote) onNote(file.name + ': the picture imported fine, but its audio could not be decoded here.');
    }
  }
  return N.addMedia(project, media);
}

const mediaOf = (project, id) => project.media.find(m => m.id === id);

/**
 * One dedicated <video> per CLIP for export.
 * A single element can only show one time at once, so two clips of the same
 * media playing simultaneously on different tracks would fight over it and one
 * would render the wrong frame.
 */
function exportElFor(media, clip){
  if (media.kind !== 'video') return media.el;
  let el = media.pool[clip.id];
  if (!el){
    el = document.createElement('video');
    el.src = media.url;
    el.preload = 'auto';
    el.muted = true;
    el.playsInline = true;
    media.pool[clip.id] = el;
  }
  return el;
}

function releasePool(project){
  for (const m of project.media){
    if (!m.pool) continue;
    for (const k of Object.keys(m.pool)){ try { m.pool[k].src = ''; } catch(_){} delete m.pool[k]; }
  }
}

/* ================= frame-accurate seeking =================
 * requestVideoFrameCallback reports mediaTime — the presentation time of the
 * frame actually on screen. Recording it lets us skip a seek entirely when the
 * element is already showing the frame we want, which is the common case
 * whenever the timeline fps is higher than the source fps.
 */
function markFrame(el, meta){
  if (!meta || meta.mediaTime == null) return;
  const prev = el._nleMediaTime;
  if (prev != null && meta.mediaTime > prev){
    const d = meta.mediaTime - prev;
    // the smallest positive step observed approximates the source frame duration;
    // underestimating only costs us a skip, so this errs safe
    if (d > 5e-4 && d < 1) el._nleFrameDur = Math.min(el._nleFrameDur || d, d);
  }
  el._nleMediaTime = meta.mediaTime;
}

function seekSmart(el, want){
  const mt = el._nleMediaTime, fd = el._nleFrameDur;
  if (mt != null && fd && want >= mt && want < mt + fd * 0.95){
    el._nleSkipped = (el._nleSkipped || 0) + 1;
    return Promise.resolve(false);                 // already displaying this frame
  }
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      el.removeEventListener('seeked', onSeeked);
      resolve(true);
    };
    const onSeeked = () => {
      if (el.requestVideoFrameCallback){
        el.requestVideoFrameCallback((_, meta) => { markFrame(el, meta); finish(); });
        setTimeout(() => { if (!done){ el._nleMediaTime = el.currentTime; finish(); } }, 40);
      } else {
        el._nleMediaTime = el.currentTime;
        finish();
      }
    };
    const guard = setTimeout(finish, 5000);
    el.addEventListener('seeked', onSeeked, { once:true });
    try { el.currentTime = Math.min(want, Math.max(0, el.duration - 0.001)); }
    catch(_){ finish(); }
  });
}

/* ================= compositing ================= */
function filterString(f){
  if (!f) return 'none';
  const parts = [];
  if (f.brightness != null && f.brightness !== 1) parts.push('brightness(' + f.brightness + ')');
  if (f.contrast   != null && f.contrast   !== 1) parts.push('contrast(' + f.contrast + ')');
  if (f.saturate   != null && f.saturate   !== 1) parts.push('saturate(' + f.saturate + ')');
  if (f.blur)      parts.push('blur(' + f.blur + 'px)');
  if (f.grayscale) parts.push('grayscale(' + f.grayscale + ')');
  return parts.length ? parts.join(' ') : 'none';
}

function paint(ctx, src, sw, sh, project, clip, t, fit){
  if (!sw || !sh) return;
  const W = project.width, H = project.height;
  const tr = clip.transform || {};
  const alpha = N.opacityAt(clip, t);
  if (alpha <= 0.001) return;

  const s = fit === 'cover' ? Math.max(W/sw, H/sh) : Math.min(W/sw, H/sh);
  const scale = s * (tr.scale == null ? 1 : tr.scale);
  const dw = sw * scale, dh = sh * scale;
  const dx = (W - dw)/2 + (tr.x || 0) * W;
  const dy = (H - dh)/2 + (tr.y || 0) * H;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.filter = filterString(clip.filters);
  if (tr.rotation){
    ctx.translate(dx + dw/2, dy + dh/2);
    ctx.rotate(tr.rotation * Math.PI/180);
    ctx.drawImage(src, -dw/2, -dh/2, dw, dh);
  } else {
    ctx.drawImage(src, dx, dy, dw, dh);
  }
  ctx.restore();
}

function paintText(ctx, project, clip, t){
  const x = clip.text || {};
  const alpha = N.opacityAt(clip, t);
  if (alpha <= 0.001) return;
  const W = project.width, H = project.height;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = (x.bold ? '700 ' : '400 ') + (x.size || 64) + 'px ' + (x.font || 'sans-serif');
  ctx.textAlign = x.align || 'center';
  ctx.textBaseline = 'middle';
  if (x.shadow){
    ctx.shadowColor = 'rgba(0,0,0,.65)';
    ctx.shadowBlur = (x.size || 64) * 0.14;
    ctx.shadowOffsetY = (x.size || 64) * 0.05;
  }
  ctx.fillStyle = x.color || '#fff';
  const lines = String(x.content || '').split('\n');
  const lh = (x.size || 64) * 1.2;
  const cx = (x.x == null ? 0.5 : x.x) * W;
  const cy = (x.y == null ? 0.5 : x.y) * H - (lines.length - 1) * lh / 2;
  lines.forEach((ln, i) => ctx.fillText(ln, cx, cy + i*lh));
  ctx.restore();
}

/**
 * Paint the whole timeline at time t.
 * With `exact`, every source is seeked first — and all of them in PARALLEL,
 * because seeking three tracks one after another triples the wait per frame.
 */
async function renderFrame(ctx, project, t, exact){
  const W = project.width, H = project.height;
  ctx.save();
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  ctx.fillStyle = project.background || '#000';
  ctx.fillRect(0,0,W,H);
  ctx.restore();

  const { video } = N.activeAt(project, t);

  if (exact){
    await Promise.all(video.map(async ({ clip }) => {
      if (clip.kind !== 'video') return;
      const m = mediaOf(project, clip.mediaId);
      if (!m) return;
      const el = exportElFor(m, clip);
      const want = Math.min(N.sourceTime(clip, t), Math.max(0, m.duration - 0.001));
      try { await seekSmart(el, want); } catch(_){ /* keep whatever frame we have */ }
    }));
  }

  for (const { clip } of video){
    if (clip.kind === 'text'){ paintText(ctx, project, clip, t); continue; }
    const m = mediaOf(project, clip.mediaId);
    if (!m) continue;
    if (clip.kind === 'image'){
      paint(ctx, m.el, m.width, m.height, project, clip, t, clip.fit || 'contain');
      continue;
    }
    const el = exact ? exportElFor(m, clip) : m.el;
    paint(ctx, el, el.videoWidth || m.width, el.videoHeight || m.height,
          project, clip, t, clip.fit || 'contain');
  }
}

/* ================= audio mixdown ================= */
async function mixdown(project, duration, onProgress){
  const sr = project.sampleRate || 48000;
  const frames = Math.max(1, Math.ceil(duration * sr));
  const jobs = [];

  for (const track of project.tracks){
    if (track.muted) continue;
    for (const clip of track.clips){
      if (clip.kind === 'text' || clip.kind === 'image') continue;
      const m = mediaOf(project, clip.mediaId);
      if (!m || !m.hasAudio || !m.audio) continue;
      jobs.push({ clip, buffer: m.audio });
    }
  }
  if (!jobs.length) return null;

  const OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext;
  const ctx = new OAC(2, frames, sr);

  for (const { clip, buffer } of jobs){
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = clip.speed || 1;

    const gain = ctx.createGain();
    const vol = clip.volume == null ? 1 : clip.volume;
    const t0 = Math.max(0, clip.start);
    const t1 = t0 + clip.duration;
    const fi = Math.min(clip.fadeIn  || 0, clip.duration/2);
    const fo = Math.min(clip.fadeOut || 0, clip.duration/2);

    gain.gain.setValueAtTime(fi > 0 ? 0.0001 : vol, t0);
    if (fi > 0) gain.gain.linearRampToValueAtTime(vol, t0 + fi);
    if (fo > 0){
      gain.gain.setValueAtTime(vol, Math.max(t0 + fi, t1 - fo));
      gain.gain.linearRampToValueAtTime(0.0001, t1);
    }

    src.connect(gain).connect(ctx.destination);
    const srcDur = clip.duration * (clip.speed || 1);
    try { src.start(t0, clip.inPoint, srcDur); } catch(_){ }
    src.stop(t1 + 0.001);
  }

  const rendered = await ctx.startRendering();
  if (onProgress) onProgress(1);
  const chans = [];
  for (let c = 0; c < rendered.numberOfChannels; c++) chans.push(rendered.getChannelData(c));
  return { blob: encodeWAV(chans, sr), sampleRate: sr };
}

/* ================= export ================= */
const webCodecsAvailable = () =>
  typeof root.VideoEncoder === 'function' && typeof root.VideoFrame === 'function';

class Cancelled extends Error {
  constructor(){ super('Export cancelled.'); this.cancelled = true; }
}

/* ---- H.264 bitstream shape ----
 * We ask the encoder for Annex-B (NALs separated by 00 00 00 01), which is what
 * ffmpeg's raw h264 demuxer reads. Not every browser honours that hint; some
 * return AVCC instead, where each NAL carries a length prefix and the SPS/PPS
 * live outside the stream in decoderConfig.description. Muxing AVCC as if it
 * were Annex-B produces an unplayable file, so detect it and convert.
 */
const isAnnexB = c =>
  !!c && c.length >= 4 && c[0] === 0 && c[1] === 0 &&
  (c[2] === 1 || (c[2] === 0 && c[3] === 1));

function avccToAnnexB(chunks, description){
  const START = Uint8Array.of(0,0,0,1);
  const parts = [];
  let nalLen = 4;

  if (description){
    const d = description instanceof Uint8Array ? description : new Uint8Array(description);
    if (d.length > 6){
      nalLen = (d[4] & 0x03) + 1;
      let p = 5;
      const readSet = count => {
        for (let i = 0; i < count && p + 2 <= d.length; i++){
          const len = (d[p] << 8) | d[p+1];
          p += 2;
          if (len <= 0 || p + len > d.length) break;
          parts.push(START, d.slice(p, p + len));   // parameter sets go in-band
          p += len;
        }
      };
      readSet(d[p++] & 0x1f);                       // SPS
      if (p < d.length) readSet(d[p++]);            // PPS
    }
  }

  for (const c of chunks){
    let p = 0;
    while (p + nalLen <= c.length){
      let len = 0;
      for (let k = 0; k < nalLen; k++) len = (len * 256) + c[p + k];
      p += nalLen;
      if (len <= 0 || p + len > c.length) break;
      parts.push(START, c.slice(p, p + len));
      p += len;
    }
  }
  return parts;
}

/**
 * Render the timeline to an MP4.
 * hooks: {onStage, onProgress, onPhase('audio'|'encode'|'mux'), shouldStop}
 */
async function exportProject(project, opts, hooks){
  opts = opts || {}; hooks = hooks || {};
  const say = s => hooks.onStage && hooks.onStage(s);
  const prog = v => hooks.onProgress && hooks.onProgress(Math.max(0, Math.min(1, v)));
  const phase = p => hooks.onPhase && hooks.onPhase(p);
  const stopped = () => !!(hooks.shouldStop && hooks.shouldStop());
  const abortIf = () => { if (stopped()) throw new Cancelled(); };

  const fps = opts.fps || project.fps || 30;
  const total = N.duration(project);
  if (total <= 0) throw new Error('The timeline is empty — add a clip first.');

  const W = Math.max(2, Math.round(project.width /2)*2);
  const H = Math.max(2, Math.round(project.height/2)*2);
  const frameCount = Math.max(1, Math.round(total * fps));

  phase('audio');
  say('Mixing the audio…');
  const audio = await mixdown(project, total);
  abortIf();
  prog(0.04);

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha:false });

  /* --- pick an encoder, and verify it before committing to it --- */
  let useCodecs = webCodecsAvailable() && opts.encoder !== 'ffmpeg';
  const encCfg = {
    codec: opts.codec || 'avc1.42001f',
    width: W, height: H,
    bitrate: opts.bitrate || Math.round(W*H*fps*0.09),
    framerate: fps,
    avc: { format: 'annexb' },
  };
  if (useCodecs){
    // asking first turns "the whole export dies" into "quietly use ffmpeg"
    try {
      const sup = await root.VideoEncoder.isConfigSupported(encCfg);
      if (!sup || !sup.supported) useCodecs = false;
    } catch(_){ useCodecs = false; }
    if (!useCodecs) say('This browser cannot encode H.264 directly — using ffmpeg instead.');
  }

  const inputs = [];
  let framesWritten = 0;
  let uiAt = 0;
  const tick = async (i, label) => {
    const now = performance.now();
    if (now - uiAt < 90 && i !== frameCount - 1) return;
    uiAt = now;
    prog(0.04 + 0.80 * (i+1)/frameCount);
    say(label + ' ' + (i+1) + ' of ' + frameCount + '…');
    await idle();                       // one yield per ~90ms keeps cancel responsive
  };

  phase('encode');

  if (useCodecs){
    say('Encoding video…');
    const chunks = [];
    let encErr = null, codecDesc = null;
    const encoder = new root.VideoEncoder({
      output: (chunk, metadata) => {
        if (!codecDesc && metadata && metadata.decoderConfig && metadata.decoderConfig.description)
          codecDesc = metadata.decoderConfig.description;
        const b = new Uint8Array(chunk.byteLength);
        chunk.copyTo(b);
        chunks.push(b);
      },
      error: e => { encErr = e; },
    });
    encoder.configure(encCfg);

    try {
      const gop = Math.max(1, Math.round(fps * 2));
      for (let i = 0; i < frameCount; i++){
        abortIf();
        if (encErr) throw new Error('Video encoder failed: ' + encErr.message);
        await renderFrame(ctx, project, i / fps, true);

        let frame;
        try {
          frame = new root.VideoFrame(canvas, {
            timestamp: Math.round(i * 1e6 / fps),
            duration: Math.round(1e6 / fps),
          });
        } catch(e){ throw new Error('Could not capture frame ' + (i+1) + ': ' + e.message); }

        encoder.encode(frame, { keyFrame: i % gop === 0 });
        frame.close();

        // real backpressure: a single yield let the queue grow without bound,
        // which on a slow encoder ate memory until the tab died
        while (encoder.encodeQueueSize > 8 && !encErr){
          abortIf();
          await new Promise(r => setTimeout(r, 4));
        }
        await tick(i, 'Encoding frame');
      }
      await encoder.flush();
    } finally {
      try { encoder.close(); } catch(_){}
    }
    if (encErr) throw new Error('Video encoder failed: ' + encErr.message);

    if (!chunks.length) throw new Error('The encoder produced no data.');

    // if the browser ignored the Annex-B request, repackage rather than emit a
    // file ffmpeg cannot parse
    let parts = chunks;
    if (!isAnnexB(chunks[0])){
      say('Repackaging the bitstream…');
      parts = avccToAnnexB(chunks, codecDesc);
      if (!parts.length) throw new Error('The encoder returned a bitstream that could not be muxed.');
    }

    // hand ffmpeg a Blob rather than one big concatenated array: the browser can
    // back it with disk, and it halves peak memory on long timelines
    inputs.push({ name:'v.h264', data: new Blob(parts, { type:'application/octet-stream' }) });

  } else {
    say('Rendering frames…');
    const ff = await C.FF.load({ onStatus: say });
    try {
      for (let i = 0; i < frameCount; i++){
        abortIf();
        await renderFrame(ctx, project, i / fps, true);
        const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.92));
        await ff.writeFile('f' + String(i+1).padStart(6,'0') + '.jpg',
                           new Uint8Array(await blob.arrayBuffer()));
        framesWritten = i + 1;
        await tick(i, 'Rendering frame');
      }
    } catch(e){
      await purgeFrames(framesWritten);      // cancelling used to leave every frame behind
      throw e;
    }
  }

  abortIf();
  phase('mux');
  say('Muxing into an MP4…');
  prog(0.86);

  if (audio) inputs.push({ name:'a.wav', data: audio.blob });

  const args = ['-framerate', String(fps), '-i', useCodecs ? 'v.h264' : 'f%06d.jpg'];
  if (audio) args.push('-i', 'a.wav');
  if (useCodecs) args.push('-c:v', 'copy');
  else args.push('-c:v','libx264','-crf', String(opts.crf || 20),
                 '-preset', opts.preset || 'veryfast', '-pix_fmt','yuv420p');
  if (audio) args.push('-c:a','aac','-b:a','192k','-shortest');
  args.push('-movflags','+faststart','out.mp4');

  let data;
  try {
    data = await C.FF.run(args,
      useCodecs ? inputs : (audio ? [{ name:'a.wav', data:audio.blob }] : []),
      'out.mp4', { onStatus: say, onProgress: v => prog(0.86 + v*0.13) });
  } finally {
    if (!useCodecs) await purgeFrames(framesWritten);
    releasePool(project);
  }

  prog(1);
  return { blob: new Blob([data.buffer], { type:'video/mp4' }),
           frames: frameCount, duration: total, hadAudio: !!audio,
           encoder: useCodecs ? 'webcodecs' : 'ffmpeg' };

  /** ffmpeg's filesystem is in memory and survives between runs — clear it. */
  async function purgeFrames(n){
    if (!n) return;
    try {
      const ff = await C.FF.load();
      for (let i = 0; i < n; i++){
        try { await ff.deleteFile('f' + String(i+1).padStart(6,'0') + '.jpg'); } catch(_){}
      }
    } catch(_){}
  }
}

root.NleRender = { importFile, mediaOf, renderFrame, mixdown, exportProject,
                   webCodecsAvailable, filterString, kindOf, seekSmart, releasePool,
                   isAnnexB, avccToAnnexB };

})(window);
