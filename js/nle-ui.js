/* nle-ui.js — the timeline editor: media pool, preview, tracks, clip editing,
 * properties and export. */
(function () {
'use strict';

const C = window.Core, N = window.Nle, R = window.NleRender;
const { el, fmtBytes, escapeHtml, download, idle } = C;

const root = document.getElementById('panel-editor');
if (!root) return;
const q = s => root.querySelector('[data-el=' + s + ']');

/* ================= state ================= */
let project = N.createProject({ width:1280, height:720, fps:30 });
let selectedId = null;
let pxPerSec = 60;
const HEADW = 130;          // must match .lanehead width in the CSS
let playhead = 0;
let playing = false;
let rafId = 0;
let playStartWall = 0, playStartT = 0;
let exportBlob = null, cancelExport = false;

const pool = q('pool'), lanes = q('lanes'), ruler = q('ruler'),
      preview = q('preview'), props = q('props');
const pctx = preview.getContext('2d', { alpha:false });

/* ================= helpers ================= */
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const fmtT = t => {
  t = Math.max(0, t);
  const m = Math.floor(t/60), s = t - m*60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
};
const timeToX = t => t * pxPerSec;
const xToTime = x => x / pxPerSec;
const contentW = () => Math.max(600, timeToX(Math.max(N.duration(project), 10)) + 400);

function note(msg, cls){
  const n = q('note');
  n.className = 'note ' + (cls || '');
  n.textContent = msg;
  n.classList.remove('hide');
  clearTimeout(note._t);
  note._t = setTimeout(() => n.classList.add('hide'), 6000);
}

/* ================= media pool ================= */
C.makePicker(q('pick'), {
  kind:'media', multiple:true, icon:'🎞️',
  accept:'video/*,audio/*,image/*',
  re:/\.(mp4|webm|mov|mkv|avi|m4v|mp3|wav|m4a|aac|ogg|opus|flac|jpe?g|png|gif|bmp|webp)$/i,
  label:'Drag &amp; drop video, audio or images',
  sub:'They land in the media pool — then drag them onto the timeline',
  onFiles: importAll,
});

async function importAll(files){
  for (const f of files){
    try {
      q('poolstat').textContent = 'Importing ' + f.name + '…';
      const m = await R.importFile(project, f, msg => note(msg, ''));
      await makeThumb(m);
    } catch(e){ note(e.message, 'err'); }
  }
  q('poolstat').textContent = '';
  renderPool();
}

/** One small poster frame per media, used as the clip background. */
async function makeThumb(m){
  try {
    const cv = document.createElement('canvas');
    cv.width = 160; cv.height = 90;
    const c = cv.getContext('2d');
    c.fillStyle = '#0b0e14'; c.fillRect(0,0,160,90);
    if (m.kind === 'image'){
      drawFit(c, m.el, m.width, m.height);
    } else if (m.kind === 'video'){
      await C.seek(m.el, Math.min(1, m.duration/2));
      drawFit(c, m.el, m.el.videoWidth, m.el.videoHeight);
    } else {
      c.fillStyle = '#0e7490'; c.fillRect(0,0,160,90);
    }
    m.thumb = cv.toDataURL('image/jpeg', 0.7);
  } catch(_){ m.thumb = null; }
}
function drawFit(c, src, sw, sh){
  if (!sw || !sh) return;
  const s = Math.max(160/sw, 90/sh);
  c.drawImage(src, (160-sw*s)/2, (90-sh*s)/2, sw*s, sh*s);
}

function renderPool(){
  pool.innerHTML = '';
  if (!project.media.length){
    pool.innerHTML = '<div class="hint" style="padding:6px 2px">Nothing imported yet.</div>';
    return;
  }
  for (const m of project.media){
    const d = el('div','poolitem');
    d.draggable = true;
    d.innerHTML =
      '<span class="pth"' + (m.thumb ? ' style="background-image:url(' + m.thumb + ')"' : '') + '>' +
        (m.kind === 'audio' ? '🎵' : '') + '</span>' +
      '<span class="pinfo"><b>' + escapeHtml(m.name) + '</b>' +
      '<small>' + m.kind + ' · ' + fmtT(m.duration) +
      (m.width ? ' · ' + m.width + '×' + m.height : '') +
      (m.kind === 'video' && !m.hasAudio ? ' · no audio' : '') + '</small></span>';
    d.ondragstart = e => {
      e.dataTransfer.setData('text/nle-media', m.id);
      e.dataTransfer.effectAllowed = 'copy';
    };
    d.ondblclick = () => addToTimeline(m);
    const b = el('button','ghost sm'); b.textContent = '+'; b.title = 'Append to the timeline';
    b.onclick = () => addToTimeline(m);
    d.appendChild(b);
    pool.appendChild(d);
  }
}

function clipFromMedia(m, start){
  const kind = m.kind === 'audio' ? 'audio' : m.kind === 'image' ? 'image' : 'video';
  return N.makeClip({
    kind, mediaId: m.id, name: m.name,
    start: start || 0,
    duration: m.kind === 'image' ? 5 : m.duration,
    inPoint: 0,
    sourceDuration: m.kind === 'image' ? null : m.duration,
  });
}

function defaultTrackFor(kind){
  const want = kind === 'audio' ? 'audio' : 'video';
  return project.tracks.find(t => t.kind === want);
}

function addToTimeline(m){
  const tr = defaultTrackFor(m.kind);
  N.appendClip(project, tr.id, clipFromMedia(m));
  refresh();
}

/* ================= timeline rendering ================= */
function renderRuler(){
  const dur = Math.max(N.duration(project), 10);
  const w = contentW();
  ruler.style.width = w + 'px';
  // choose a tick spacing that stays readable at the current zoom
  const targets = [0.1,0.25,0.5,1,2,5,10,15,30,60,120,300];
  const step = targets.find(s => s * pxPerSec >= 70) || 600;
  let html = '';
  for (let t = 0; t <= dur + step; t += step){
    html += '<span class="tick" style="left:' + timeToX(t) + 'px">' + fmtT(t) + '</span>';
  }
  ruler.innerHTML = html;
}

function renderTracks(){
  lanes.innerHTML = '';
  for (const track of project.tracks){
    const row = el('div','lane' + (track.kind === 'audio' ? ' audio' : ''));
    row.dataset.track = track.id;

    const head = el('div','lanehead');
    head.innerHTML = '<b>' + escapeHtml(track.name) + '</b>';
    const mk = (label, title, on, fn) => {
      const b = el('button','ghost sm' + (on ? ' on' : ''));
      b.textContent = label; b.title = title; b.onclick = fn;
      return b;
    };
    head.append(
      mk(track.kind === 'audio' ? (track.muted ? '🔇' : '🔊') : (track.hidden ? '🚫' : '👁'),
         track.kind === 'audio' ? 'Mute' : 'Hide',
         track.kind === 'audio' ? track.muted : track.hidden,
         () => { if (track.kind === 'audio') track.muted = !track.muted; else track.hidden = !track.hidden; refresh(); }),
      mk('✕','Delete this track', false, () => {
        if (!N.removeTrack(project, track.id)) return note('Keep at least one track of each kind.', '');
        refresh();
      })
    );

    const body = el('div','lanebody');
    body.style.width = contentW() + 'px';
    body.dataset.track = track.id;

    for (const clip of track.clips) body.appendChild(clipEl(clip, track));

    body.ondragover = e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; body.classList.add('over'); };
    body.ondragleave = () => body.classList.remove('over');
    body.ondrop = e => {
      e.preventDefault();
      body.classList.remove('over');
      const id = e.dataTransfer.getData('text/nle-media');
      const m = id && R.mediaOf(project, id);
      if (!m) return;
      const want = m.kind === 'audio' ? 'audio' : 'video';
      if (track.kind !== want) return note('A ' + m.kind + ' file needs a ' + want + ' track.', '');
      const rect = body.getBoundingClientRect();
      let t = Math.max(0, xToTime(e.clientX - rect.left));
      t = N.snap(t, N.snapPoints(project), 8/pxPerSec);
      const c = clipFromMedia(m, t);
      N.place(project, track.id, c);
      selectedId = c.id;
      refresh();
    };

    row.append(head, body);
    lanes.appendChild(row);
  }
}

function clipEl(clip, track){
  const d = el('div','clip ' + clip.kind + (clip.id === selectedId ? ' sel' : ''));
  d.style.left = timeToX(clip.start) + 'px';
  d.style.width = Math.max(6, timeToX(clip.duration)) + 'px';
  const m = clip.mediaId && R.mediaOf(project, clip.mediaId);
  if (m && m.thumb && clip.kind !== 'audio') d.style.backgroundImage = 'url(' + m.thumb + ')';
  d.innerHTML =
    '<span class="grip l"></span>' +
    '<span class="clabel">' + escapeHtml(clip.kind === 'text' ? (clip.text.content || 'Text') : clip.name) + '</span>' +
    '<span class="grip r"></span>';
  d.dataset.clip = clip.id;

  d.onpointerdown = e => {
    e.preventDefault();
    e.stopPropagation();
    selectedId = clip.id;
    const grip = e.target.classList.contains('grip') ? (e.target.classList.contains('l') ? 'start' : 'end') : null;
    startDrag(e, clip, track, grip, d);
    renderProps();
    lanes.querySelectorAll('.clip').forEach(n => n.classList.toggle('sel', n.dataset.clip === selectedId));
  };
  return d;
}

/* ---- pointer drag: move a clip, or trim an edge ---- */
function startDrag(e, clip, track, grip, node){
  const startX = e.clientX;
  const origStart = clip.start, origDur = clip.duration;
  const snapPts = N.snapPoints(project, clip.id);
  let moved = false;
  let overTrack = track.id;

  const onMove = ev => {
    const dx = ev.clientX - startX;
    if (!moved && Math.abs(dx) < 3) return;
    moved = true;
    const dt = xToTime(dx);

    if (grip){
      // rebuild from the original each time so the drag is not cumulative
      clip.start = origStart; clip.duration = origDur;
      N.trimClip(project, clip.id, grip, dt);
    } else {
      let want = Math.max(0, origStart + dt);
      want = N.snap(want, snapPts, 8/pxPerSec);
      // dropping onto a different lane
      const lane = document.elementFromPoint(ev.clientX, ev.clientY);
      const laneBody = lane && lane.closest ? lane.closest('.lanebody') : null;
      if (laneBody && laneBody.dataset.track) overTrack = laneBody.dataset.track;
      const dest = N.trackOf(project, overTrack);
      const okKind = dest && (dest.kind === 'audio' ? clip.kind === 'audio'
                                                    : clip.kind !== 'audio');
      N.moveClip(project, clip.id, okKind ? overTrack : track.id, want);
    }
    refresh(true);
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (moved) refresh();
    else renderProps();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

/* ================= playhead & preview ================= */
function setPlayhead(t, redraw){
  playhead = clamp(t, 0, Math.max(N.duration(project), 0.001));
  q('phead').style.left = (HEADW + timeToX(playhead)) + 'px';
  q('time').textContent = fmtT(playhead) + ' / ' + fmtT(N.duration(project));
  if (redraw !== false) drawPreview();
}

let drawPending = false;
function drawPreview(){
  if (drawPending) return;
  drawPending = true;
  requestAnimationFrame(async () => {
    drawPending = false;
    if (preview.width !== project.width || preview.height !== project.height){
      preview.width = project.width;
      preview.height = project.height;
    }
    await R.renderFrame(pctx, project, playhead, !playing);
  });
}

/* ---- transport ---- */
function play(){
  if (playing) return;
  if (playhead >= N.duration(project) - 0.01) setPlayhead(0);
  playing = true;
  playStartWall = performance.now();
  playStartT = playhead;
  q('play').textContent = '⏸';
  syncMedia(true);
  const tick = () => {
    if (!playing) return;
    const t = playStartT + (performance.now() - playStartWall)/1000;
    if (t >= N.duration(project)){ stop(); return; }
    playhead = t;
    q('phead').style.left = (HEADW + timeToX(playhead)) + 'px';
    q('time').textContent = fmtT(playhead) + ' / ' + fmtT(N.duration(project));
    keepInView();
    syncMedia(false);
    R.renderFrame(pctx, project, playhead, false);
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

function pause(){
  playing = false;
  cancelAnimationFrame(rafId);
  q('play').textContent = '▶';
  for (const m of project.media) if (m.el && m.el.pause) m.el.pause();
  drawPreview();
}
function stop(){ pause(); setPlayhead(0); }

/** Keep every active source playing at roughly the right point. */
function syncMedia(hard){
  const { video, audio } = N.activeAt(project, playhead);
  const live = new Set();
  for (const { clip, track } of video.concat(audio)){
    if (clip.kind === 'text' || clip.kind === 'image') continue;
    const m = R.mediaOf(project, clip.mediaId);
    if (!m || !m.el) continue;
    live.add(m.id);
    const want = N.sourceTime(clip, playhead);
    if (hard || Math.abs(m.el.currentTime - want) > 0.28){
      try { m.el.currentTime = Math.min(want, Math.max(0, m.duration - 0.05)); } catch(_){}
    }
    m.el.playbackRate = clip.speed || 1;
    const isAudible = m.kind === 'audio' || (m.hasAudio && track.kind === 'video');
    m.el.muted = track.muted || (m.kind === 'video' && !isAudible);
    m.el.volume = clamp(N.gainAt(clip, playhead), 0, 1);
    if (m.el.paused) m.el.play().catch(() => {});
  }
  for (const m of project.media)
    if (m.el && m.el.pause && !live.has(m.id) && !m.el.paused) m.el.pause();
}

function keepInView(){
  const scroller = q('scroll');
  const x = timeToX(playhead);
  const left = scroller.scrollLeft, w = scroller.clientWidth;
  if (x < left + 60 || x > left + w - 120) scroller.scrollLeft = Math.max(0, x - w*0.35);
}

/* ================= properties panel ================= */
function renderProps(){
  const hit = selectedId && N.findClip(project, selectedId);
  if (!hit){ props.innerHTML = '<div class="hint">Select a clip to edit it.</div>'; return; }
  const c = hit.clip;
  const isVis = c.kind !== 'audio';
  const isAud = c.kind === 'audio' || c.kind === 'video';

  const row = (label, inner, hint) =>
    '<div class="prow"><label>' + label + '</label>' + inner +
    (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div>';
  const num = (k, v, min, max, step) =>
    '<input type="number" data-k="' + k + '" value="' + v + '" min="' + min +
    '" max="' + max + '" step="' + step + '">';
  const rng = (k, v, min, max, step) =>
    '<input type="range" data-k="' + k + '" value="' + v + '" min="' + min +
    '" max="' + max + '" step="' + step + '">';

  let html = '<div class="phead"><b>' + escapeHtml(c.kind === 'text' ? 'Text' : c.name) + '</b>' +
             '<small>' + fmtT(c.start) + ' → ' + fmtT(N.endOf(c)) + '  ·  ' + c.duration.toFixed(2) + 's</small></div>';

  if (c.kind === 'text'){
    html += row('Content', '<textarea data-k="text.content" rows="3">' + escapeHtml(c.text.content) + '</textarea>');
    html += row('Size', num('text.size', c.text.size, 8, 400, 1));
    html += row('Colour', '<input type="color" data-k="text.color" value="' + c.text.color + '">');
    html += row('X / Y', '<div class="pair">' + num('text.x', c.text.x, 0, 1, 0.01) +
                num('text.y', c.text.y, 0, 1, 0.01) + '</div>', '0–1 across the frame');
  }
  html += row('Duration (s)', num('duration', c.duration.toFixed(2), 0.05, 3600, 0.05));
  html += row('Start (s)', num('start', c.start.toFixed(2), 0, 36000, 0.05));
  if (c.kind === 'video' || c.kind === 'audio')
    html += row('Speed — <b>' + (c.speed||1) + '×</b>', rng('speed', c.speed||1, 0.25, 4, 0.05),
                'Changes how much source the clip consumes');
  if (isVis){
    html += row('Opacity', rng('transform.opacity', c.transform.opacity, 0, 1, 0.01));
    html += row('Scale', rng('transform.scale', c.transform.scale, 0.05, 4, 0.01));
    html += row('Position X', rng('transform.x', c.transform.x, -1, 1, 0.005));
    html += row('Position Y', rng('transform.y', c.transform.y, -1, 1, 0.005));
    html += row('Rotation', rng('transform.rotation', c.transform.rotation, -180, 180, 1));
    html += '<div class="psep">Colour</div>';
    html += row('Brightness', rng('filters.brightness', c.filters.brightness, 0, 3, 0.01));
    html += row('Contrast',   rng('filters.contrast',   c.filters.contrast,   0, 3, 0.01));
    html += row('Saturation', rng('filters.saturate',   c.filters.saturate,   0, 3, 0.01));
    html += row('Blur',       rng('filters.blur',       c.filters.blur,       0, 40, 0.5));
    html += row('Grayscale',  rng('filters.grayscale',  c.filters.grayscale,  0, 1, 0.01));
  }
  if (isAud){
    html += '<div class="psep">Audio</div>';
    html += row('Volume', rng('volume', c.volume, 0, 2, 0.01));
  }
  html += '<div class="psep">Fades</div>';
  html += row('Fade in (s)',  num('fadeIn',  c.fadeIn,  0, 30, 0.05));
  html += row('Fade out (s)', num('fadeOut', c.fadeOut, 0, 30, 0.05));

  props.innerHTML = html;
  props.querySelectorAll('[data-k]').forEach(input => {
    const handler = () => {
      const path = input.dataset.k.split('.');
      let v = input.type === 'color' || input.tagName === 'TEXTAREA' ? input.value : parseFloat(input.value);
      if (typeof v === 'number' && !isFinite(v)) return;
      let target = c;
      while (path.length > 1) target = target[path.shift()];
      target[path[0]] = v;

      if (input.dataset.k === 'start' || input.dataset.k === 'duration'){
        const track = hit.track;
        track.clips = track.clips.filter(x => x.id !== c.id);
        N.place(project, track.id, c);
        refresh();
      } else {
        drawPreview();
        if (input.dataset.k === 'text.content')
          lanes.querySelectorAll('.clip[data-clip="' + c.id + '"] .clabel')
               .forEach(n => n.textContent = v);
      }
    };
    input.oninput = handler;
  });
}

/* ================= toolbar ================= */
q('play').onclick = () => playing ? pause() : play();
q('stopb').onclick = stop;
q('prevf').onclick = () => { pause(); setPlayhead(playhead - 1/project.fps); };
q('nextf').onclick = () => { pause(); setPlayhead(playhead + 1/project.fps); };

q('split').onclick = () => {
  const made = N.splitAll(project, playhead);
  if (!made.length) return note('The playhead is not over any clip.', '');
  refresh();
  note('Split ' + made.length + ' clip' + (made.length>1?'s':'') + ' at the playhead.', 'ok');
};
q('del').onclick = () => {
  if (!selectedId) return note('Select a clip first.', '');
  N.removeClip(project, selectedId);
  selectedId = null;
  refresh();
};
q('addtext').onclick = () => {
  const tr = project.tracks.find(t => t.kind === 'video');
  const c = N.makeClip({ kind:'text', start:playhead, duration:4, name:'Text',
                         text:{ content:'Your title here' } });
  N.place(project, tr.id, c);
  selectedId = c.id;
  refresh();
};
q('addv').onclick = () => { N.addTrack(project,'video'); refresh(); };
q('adda').onclick = () => { N.addTrack(project,'audio'); refresh(); };
q('ripple').onclick = () => {
  for (const t of project.tracks) N.rippleTrack(project, t.id);
  refresh();
  note('Gaps closed on every track.', 'ok');
};
q('zin').onclick  = () => { pxPerSec = Math.min(400, pxPerSec*1.5); refresh(); };
q('zout').onclick = () => { pxPerSec = Math.max(6, pxPerSec/1.5); refresh(); };
q('zfit').onclick = () => {
  const d = Math.max(N.duration(project), 1);
  pxPerSec = clamp((q('scroll').clientWidth - 40) / d, 6, 400);
  refresh();
};

/* scrubbing on the ruler */
function scrubFrom(e){
  const rect = ruler.getBoundingClientRect();
  setPlayhead(xToTime(e.clientX - rect.left));
}
q('ruler').onpointerdown = e => {
  pause();
  scrubFrom(e);
  const mv = ev => scrubFrom(ev);
  const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', up);
};

/* keyboard */
window.addEventListener('keydown', e => {
  if (root.classList.contains('hide')) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  if (e.code === 'Space'){ e.preventDefault(); playing ? pause() : play(); }
  else if (e.key === 's' || e.key === 'S'){ q('split').click(); }
  else if (e.key === 'Delete' || e.key === 'Backspace'){ e.preventDefault(); q('del').click(); }
  else if (e.key === 'ArrowLeft'){ e.preventDefault(); pause(); setPlayhead(playhead - (e.shiftKey ? 1 : 1/project.fps)); }
  else if (e.key === 'ArrowRight'){ e.preventDefault(); pause(); setPlayhead(playhead + (e.shiftKey ? 1 : 1/project.fps)); }
  else if (e.key === 'Home'){ setPlayhead(0); }
});

/* ================= project settings ================= */
['pw','ph','pfps'].forEach(k => q(k).onchange = () => {
  project.width  = Math.max(16, +q('pw').value || 1280);
  project.height = Math.max(16, +q('ph').value || 720);
  project.fps    = clamp(+q('pfps').value || 30, 1, 120);
  drawPreview();
});
q('preset').onchange = () => {
  const [w,h] = q('preset').value.split('x').map(Number);
  if (w && h){ q('pw').value = w; q('ph').value = h; q('pw').onchange(); }
};

/* ================= export ================= */
q('export').onclick = async () => {
  if (!N.duration(project)) return note('The timeline is empty — drag something onto it first.', 'err');
  pause();
  cancelExport = false;
  q('exportbox').classList.remove('hide');
  q('exportdone').classList.add('hide');
  q('exprog').style.width = '0%';
  q('export').disabled = true;

  try {
    const res = await R.exportProject(project, {
      fps: project.fps,
      encoder: q('encoder').value,
      crf: +q('crf').value,
    }, {
      onStage: s => q('exstat').textContent = s,
      onProgress: v => q('exprog').style.width = (v*100).toFixed(1) + '%',
      shouldStop: () => cancelExport,
    });
    exportBlob = res.blob;
    q('exportdone').classList.remove('hide');
    q('exmsg').innerHTML = '✅ Rendered <b>' + res.frames + '</b> frames (' + fmtT(res.duration) +
      ') — <b>' + fmtBytes(res.blob.size) + '</b>' +
      (res.hadAudio ? ' with audio' : ', silent') +
      ' · encoder: <b>' + res.encoder + '</b>.';
    q('exresult').src = URL.createObjectURL(res.blob);
  } catch(e){
    q('exstat').textContent = '';
    note('Export failed: ' + e.message, 'err');
  } finally {
    q('export').disabled = false;
  }
};
q('excancel').onclick = () => { cancelExport = true; note('Cancelling…', ''); };
q('exsave').onclick = () => download(exportBlob, 'timeline_export.mp4');
q('exclose').onclick = () => q('exportbox').classList.add('hide');

/* ================= refresh ================= */
let lightPending = false;
function refresh(light){
  if (light){
    // during a drag only the geometry changes; skip the full rebuild
    if (lightPending) return;
    lightPending = true;
    requestAnimationFrame(() => {
      lightPending = false;
      for (const track of project.tracks)
        for (const clip of track.clips){
          const n = lanes.querySelector('.clip[data-clip="' + clip.id + '"]');
          if (n){
            n.style.left = timeToX(clip.start) + 'px';
            n.style.width = Math.max(6, timeToX(clip.duration)) + 'px';
          }
        }
    });
    return;
  }
  renderRuler();
  renderTracks();
  q('phead').style.height = (lanes.scrollHeight + 26) + 'px';
  setPlayhead(Math.min(playhead, Math.max(N.duration(project), 0)));
  renderProps();
  const errs = N.validate(project);
  if (errs.length) note('Timeline problem: ' + errs[0], 'err');
}

/* ================= boot ================= */
q('pw').value = project.width;
q('ph').value = project.height;
q('pfps').value = project.fps;
q('codecnote').textContent = R.webCodecsAvailable()
  ? 'Fast path available: your browser can encode H.264 directly.'
  : 'Your browser lacks WebCodecs, so frames go through ffmpeg — slower, same result.';
renderPool();
refresh();

})();
