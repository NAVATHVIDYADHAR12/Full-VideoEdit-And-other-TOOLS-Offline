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
const { seek, idle, encodeWAV } = C;

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

/**
 * Load a file into the project's media pool. Video and audio get a decoded
 * AudioBuffer too where possible — that is what the export mixdown works from.
 */
async function importFile(project, file, onNote){
  const kind = kindOf(file);
  if (!kind) throw new Error(file.name + ' is not a video, audio or image file.');
  const url = URL.createObjectURL(file);

  const media = { name:file.name, kind, file, url, duration:0, width:0, height:0,
                  audio:null, hasAudio:false };

  if (kind === 'image'){
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Could not read ' + file.name)); img.src = url; });
    media.el = img;
    media.width = img.naturalWidth;
    media.height = img.naturalHeight;
    media.duration = 5;                       // images get a default 5s on the timeline
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

    // a separate element is used for export seeking so preview playback is undisturbed
    if (kind === 'video'){
      const ex = document.createElement('video');
      ex.src = url; ex.preload = 'auto'; ex.muted = true; ex.playsInline = true;
      media.exportEl = ex;
    }

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

/** Draw one source into the frame, honouring transform, filters and opacity. */
function paint(ctx, src, sw, sh, project, clip, t, fit){
  if (!sw || !sh) return;
  const W = project.width, H = project.height;
  const tr = clip.transform || {};
  const alpha = N.opacityAt(clip, t);
  if (alpha <= 0.001) return;

  // "contain" keeps the whole frame visible; "cover" fills and crops
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
 * @param {boolean} exact  seek every source first (export); otherwise use whatever
 *                         frame the element is currently showing (preview)
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
  for (const { clip } of video){
    if (clip.kind === 'text'){ paintText(ctx, project, clip, t); continue; }
    const m = mediaOf(project, clip.mediaId);
    if (!m) continue;

    if (clip.kind === 'image'){
      paint(ctx, m.el, m.width, m.height, project, clip, t, clip.fit || 'contain');
      continue;
    }
    const el = exact ? (m.exportEl || m.el) : m.el;
    if (exact){
      const want = Math.min(N.sourceTime(clip, t), Math.max(0, m.duration - 0.001));
      try { await seek(el, want); } catch(_){ /* keep going with whatever frame we have */ }
    }
    paint(ctx, el, el.videoWidth || m.width, el.videoHeight || m.height,
          project, clip, t, clip.fit || 'contain');
  }
}

/* ================= audio mixdown ================= */
/** Render every audio-bearing clip into one buffer, with fades and speed. */
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
    // offset is in SOURCE time; duration passed to start() is in source time too
    const srcDur = clip.duration * (clip.speed || 1);
    try { src.start(t0, clip.inPoint, srcDur); } catch(_){ /* clip outside the buffer */ }
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

/**
 * Render the timeline to an MP4.
 * hooks: {onStage(text), onProgress(0..1), shouldStop()}
 */
async function exportProject(project, opts, hooks){
  opts = opts || {}; hooks = hooks || {};
  const say = s => hooks.onStage && hooks.onStage(s);
  const prog = v => hooks.onProgress && hooks.onProgress(Math.max(0, Math.min(1, v)));
  const stop = () => hooks.shouldStop && hooks.shouldStop();

  const fps = opts.fps || project.fps || 30;
  const total = N.duration(project);
  if (total <= 0) throw new Error('The timeline is empty — add a clip first.');

  // h.264 needs even dimensions
  const W = Math.max(2, Math.round(project.width /2)*2);
  const H = Math.max(2, Math.round(project.height/2)*2);
  const frameCount = Math.max(1, Math.round(total * fps));

  say('Mixing the audio…');
  const audio = await mixdown(project, total);
  prog(0.04);

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha:false });

  const useCodecs = webCodecsAvailable() && opts.encoder !== 'ffmpeg';
  let videoName = null;
  const inputs = [];

  if (useCodecs){
    say('Encoding video (hardware path)…');
    const chunks = [];
    let encErr = null;
    const encoder = new root.VideoEncoder({
      output: chunk => {
        const b = new Uint8Array(chunk.byteLength);
        chunk.copyTo(b);
        chunks.push(b);
      },
      error: e => { encErr = e; },
    });
    encoder.configure({
      codec: opts.codec || 'avc1.42001f',            // H.264 baseline, widely decodable
      width: W, height: H,
      bitrate: opts.bitrate || Math.round(W*H*fps*0.09),
      framerate: fps,
      avc: { format: 'annexb' },                     // a raw stream ffmpeg can mux directly
    });

    for (let i = 0; i < frameCount; i++){
      if (stop()) { try { encoder.close(); } catch(_){} throw new Error('Export cancelled.'); }
      if (encErr) throw new Error('Video encoder failed: ' + encErr.message);
      await renderFrame(ctx, project, i / fps, true);
      const frame = new root.VideoFrame(canvas, {
        timestamp: Math.round(i * 1e6 / fps),
        duration: Math.round(1e6 / fps),
      });
      encoder.encode(frame, { keyFrame: i % Math.round(fps * 2) === 0 });
      frame.close();
      if (encoder.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 0));
      if (i % 5 === 0){ prog(0.04 + 0.80 * (i+1)/frameCount); say('Encoding frame ' + (i+1) + ' of ' + frameCount + '…'); await idle(); }
    }
    await encoder.flush();
    encoder.close();
    if (encErr) throw new Error('Video encoder failed: ' + encErr.message);

    let len = 0;
    for (const c of chunks) len += c.length;
    const h264 = new Uint8Array(len);
    let at = 0;
    for (const c of chunks){ h264.set(c, at); at += c.length; }
    videoName = 'v.h264';
    inputs.push({ name: videoName, data: h264 });

  } else {
    say('Rendering frames…');
    const ff = await C.FF.load({ onStatus: say });
    for (let i = 0; i < frameCount; i++){
      if (stop()) throw new Error('Export cancelled.');
      await renderFrame(ctx, project, i / fps, true);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.92));
      const name = 'f' + String(i+1).padStart(6,'0') + '.jpg';
      await ff.writeFile(name, new Uint8Array(await blob.arrayBuffer()));
      if (i % 5 === 0){ prog(0.04 + 0.80 * (i+1)/frameCount); say('Rendering frame ' + (i+1) + ' of ' + frameCount + '…'); await idle(); }
    }
    videoName = 'f%06d.jpg';
  }

  say('Muxing into an MP4…');
  prog(0.86);

  if (audio) inputs.push({ name:'a.wav', data: audio.blob });

  const args = useCodecs
    ? ['-framerate', String(fps), '-i', 'v.h264']
    : ['-framerate', String(fps), '-i', 'f%06d.jpg'];
  if (audio) args.push('-i', 'a.wav');
  if (useCodecs) args.push('-c:v', 'copy');
  else args.push('-c:v','libx264','-crf', String(opts.crf || 20), '-preset', opts.preset || 'veryfast', '-pix_fmt','yuv420p');
  if (audio) args.push('-c:a','aac','-b:a','192k','-shortest');
  args.push('-movflags','+faststart','out.mp4');

  const data = await C.FF.run(args, useCodecs ? inputs : (audio ? [{ name:'a.wav', data:audio.blob }] : []),
                              'out.mp4', { onStatus: say, onProgress: v => prog(0.86 + v*0.13) });

  // the JPEG path writes every frame into ffmpeg's in-memory filesystem, and
  // FF.run only cleans up the inputs it was handed — clear them or a second
  // export starts with the previous one still resident
  if (!useCodecs){
    const ff = await C.FF.load();
    for (let i = 0; i < frameCount; i++){
      try { await ff.deleteFile('f' + String(i+1).padStart(6,'0') + '.jpg'); } catch(_){}
    }
  }
  prog(1);
  return { blob: new Blob([data.buffer], { type:'video/mp4' }),
           frames: frameCount, duration: total, hadAudio: !!audio, encoder: useCodecs ? 'webcodecs' : 'ffmpeg' };
}

root.NleRender = { importFile, mediaOf, renderFrame, mixdown, exportProject,
                   webCodecsAvailable, filterString, kindOf };

})(window);
