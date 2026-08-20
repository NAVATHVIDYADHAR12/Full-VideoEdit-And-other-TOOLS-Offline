/* nle-model.js — the timeline data model for the video editor.
 *
 * Deliberately free of DOM and media APIs so the tricky parts (trimming,
 * splitting, overwrite semantics, snapping) can be unit-tested in Node.
 *
 * Units: seconds throughout. A track's clips are always kept sorted by start
 * and never overlap — every mutation restores that invariant before returning.
 */
(function (root) {
'use strict';

let seq = 0;
const uid = p => (p || 'id') + '_' + (++seq) + '_' + Math.random().toString(36).slice(2,7);
const round = t => Math.round(t * 1e6) / 1e6;      // kill float dust
const EPS = 1e-6;

/* ================= construction ================= */
function createProject(o){
  o = o || {};
  const p = {
    width: o.width || 1280,
    height: o.height || 720,
    fps: o.fps || 30,
    sampleRate: o.sampleRate || 48000,
    background: o.background || '#000000',
    media: [],
    tracks: [],
  };
  addTrack(p, 'video', 'Video 1');
  addTrack(p, 'audio', 'Audio 1');
  return p;
}

function addTrack(p, kind, name){
  const t = {
    id: uid('trk'), kind,
    name: name || (kind === 'video' ? 'Video ' : 'Audio ') + (p.tracks.filter(x => x.kind === kind).length + 1),
    muted: false, hidden: false, clips: [],
  };
  p.tracks.push(t);
  // video tracks stack upward, audio below: keep video first for predictable z-order
  p.tracks.sort((a,b) => (a.kind === b.kind) ? 0 : (a.kind === 'video' ? -1 : 1));
  return t;
}

function removeTrack(p, trackId){
  const i = p.tracks.findIndex(t => t.id === trackId);
  if (i < 0) return false;
  // never leave the project with no track of that kind
  const kind = p.tracks[i].kind;
  if (p.tracks.filter(t => t.kind === kind).length <= 1) return false;
  p.tracks.splice(i,1);
  return true;
}

function addMedia(p, m){
  const media = Object.assign({ id: uid('med') }, m);
  p.media.push(media);
  return media;
}

/** A clip is a window onto a piece of media placed at a point on the timeline. */
function makeClip(o){
  const kind = o.kind;
  const c = {
    id: uid('clip'),
    kind,                                   // video | audio | image | text
    mediaId: o.mediaId || null,
    name: o.name || kind,
    start: round(Math.max(0, o.start || 0)),
    duration: round(Math.max(0.02, o.duration || 1)),
    inPoint: round(Math.max(0, o.inPoint || 0)),
    sourceDuration: o.sourceDuration == null ? null : round(o.sourceDuration),
    speed: o.speed || 1,
    volume: o.volume == null ? 1 : o.volume,
    fadeIn: o.fadeIn || 0,
    fadeOut: o.fadeOut || 0,
    transform: Object.assign({ x:0, y:0, scale:1, rotation:0, opacity:1 }, o.transform),
    filters: Object.assign({ brightness:1, contrast:1, saturate:1, blur:0, grayscale:0 }, o.filters),
    text: o.text ? Object.assign({ content:'Text', size:64, color:'#ffffff', font:'sans-serif',
                                   align:'center', x:0.5, y:0.5, bold:true, shadow:true }, o.text) : null,
  };
  return c;
}

const trackOf = (p, trackId) => p.tracks.find(t => t.id === trackId);
const endOf = c => round(c.start + c.duration);

function findClip(p, clipId){
  for (const t of p.tracks){
    const c = t.clips.find(c => c.id === clipId);
    if (c) return { clip:c, track:t };
  }
  return null;
}

/* ================= placement with overwrite ================= */
/**
 * Insert `clip` on a track, overwriting whatever it lands on — the behaviour
 * every NLE uses for a straight drop. Existing clips are trimmed, split in two
 * if the new clip lands in the middle of them, or removed if fully covered.
 */
function place(p, trackId, clip){
  const t = trackOf(p, trackId);
  if (!t) return null;
  const a = clip.start, b = endOf(clip);
  const out = [];

  for (const c of t.clips){
    if (c.id === clip.id) continue;
    const ca = c.start, cb = endOf(c);
    if (cb <= a + EPS || ca >= b - EPS){ out.push(c); continue; }   // no overlap

    const coveredLeft  = ca >= a - EPS;
    const coveredRight = cb <= b + EPS;
    if (coveredLeft && coveredRight) continue;                      // swallowed whole

    if (!coveredLeft && !coveredRight){
      // new clip lands inside: split the old one around it
      const right = Object.assign({}, c, { id: uid('clip'),
        transform: Object.assign({}, c.transform), filters: Object.assign({}, c.filters) });
      trimTo(c, ca, a);
      trimTo(right, b, cb, c);
      out.push(c, right);
      continue;
    }
    if (!coveredLeft) trimTo(c, ca, a);                             // keep the left part
    else              trimTo(c, b, cb, c);                          // keep the right part
    out.push(c);
  }

  out.push(clip);
  t.clips = out.filter(c => c.duration > 0.019).sort((x,y) => x.start - y.start);
  return clip;
}

/** Reshape a clip to cover [a,b] on the timeline, adjusting its source in-point. */
function trimTo(c, a, b, from){
  const src = from || c;
  const shift = a - src.start;
  c.inPoint = round(Math.max(0, src.inPoint + shift * (c.speed || 1)));
  c.start = round(a);
  c.duration = round(Math.max(0, b - a));
}

/* ================= editing operations ================= */
function moveClip(p, clipId, toTrackId, newStart){
  const hit = findClip(p, clipId);
  if (!hit) return null;
  const dest = trackOf(p, toTrackId) || hit.track;
  if (dest.kind !== hit.clip.kind &&
      !(dest.kind === 'video' && (hit.clip.kind === 'image' || hit.clip.kind === 'text')))
    return null;                                     // audio cannot go on a video track

  hit.track.clips = hit.track.clips.filter(c => c.id !== clipId);
  hit.clip.start = round(Math.max(0, newStart));
  return place(p, dest.id, hit.clip);
}

/**
 * Drag a clip's edge. `edge` is 'start' or 'end'; delta is in seconds.
 * Trimming the start also moves the in-point, so the visible content stays put.
 */
function trimClip(p, clipId, edge, delta){
  const hit = findClip(p, clipId);
  if (!hit) return null;
  const c = hit.clip;
  const limit = c.sourceDuration;

  if (edge === 'start'){
    let d = delta;
    d = Math.max(d, -c.inPoint / (c.speed || 1));               // cannot expose before 0
    d = Math.min(d, c.duration - 0.05);                          // keep something visible
    const prev = neighbour(hit.track, c, -1);
    if (prev) d = Math.max(d, endOf(prev) - c.start);            // do not run into the previous clip
    c.start = round(c.start + d);
    c.inPoint = round(Math.max(0, c.inPoint + d * (c.speed || 1)));
    c.duration = round(c.duration - d);
  } else {
    let d = delta;
    d = Math.max(d, 0.05 - c.duration);
    if (limit != null){
      const maxDur = (limit - c.inPoint) / (c.speed || 1);
      d = Math.min(d, maxDur - c.duration);
    }
    const next = neighbour(hit.track, c, 1);
    if (next) d = Math.min(d, next.start - endOf(c));
    c.duration = round(Math.max(0.05, c.duration + d));
  }
  hit.track.clips.sort((a,b) => a.start - b.start);
  return c;
}

function neighbour(track, clip, dir){
  const sorted = track.clips.slice().sort((a,b) => a.start - b.start);
  const i = sorted.findIndex(c => c.id === clip.id);
  return sorted[i + dir] || null;
}

/** Cut a clip in two at an absolute timeline position. */
function splitClip(p, clipId, at){
  const hit = findClip(p, clipId);
  if (!hit) return null;
  const c = hit.clip;
  if (at <= c.start + 0.02 || at >= endOf(c) - 0.02) return null;

  const right = Object.assign({}, c, {
    id: uid('clip'),
    transform: Object.assign({}, c.transform),
    filters: Object.assign({}, c.filters),
    text: c.text ? Object.assign({}, c.text) : null,
  });
  const leftDur = round(at - c.start);
  right.inPoint = round(c.inPoint + leftDur * (c.speed || 1));
  right.start = round(at);
  right.duration = round(endOf(c) - at);
  right.fadeIn = 0;
  c.duration = leftDur;
  c.fadeOut = 0;

  hit.track.clips.push(right);
  hit.track.clips.sort((a,b) => a.start - b.start);
  return { left:c, right };
}

/** Split every clip that the playhead crosses, on every track. */
function splitAll(p, at){
  const made = [];
  for (const t of p.tracks)
    for (const c of t.clips.slice())
      if (at > c.start + 0.02 && at < endOf(c) - 0.02){
        const r = splitClip(p, c.id, at);
        if (r) made.push(r.right);
      }
  return made;
}

function removeClip(p, clipId){
  for (const t of p.tracks){
    const i = t.clips.findIndex(c => c.id === clipId);
    if (i >= 0){ t.clips.splice(i,1); return true; }
  }
  return false;
}

/** Close every gap on a track, butting clips up against each other. */
function rippleTrack(p, trackId){
  const t = trackOf(p, trackId);
  if (!t) return;
  let cursor = 0;
  for (const c of t.clips.sort((a,b) => a.start - b.start)){
    c.start = round(cursor);
    cursor = endOf(c);
  }
}

/** Append to the end of a track, which is what a plain drop from the pool does. */
function appendClip(p, trackId, clip){
  const t = trackOf(p, trackId);
  if (!t) return null;
  clip.start = round(t.clips.reduce((m,c) => Math.max(m, endOf(c)), 0));
  return place(p, trackId, clip);
}

/* ================= queries ================= */
function duration(p){
  let d = 0;
  for (const t of p.tracks)
    for (const c of t.clips) d = Math.max(d, endOf(c));
  return round(d);
}

function clipAt(track, t){
  return track.clips.find(c => t >= c.start - EPS && t < endOf(c) - EPS) || null;
}

/** Everything visible/audible at time t, video tracks bottom-up for compositing. */
function activeAt(p, t){
  const video = [], audio = [];
  for (const tr of p.tracks){
    const c = clipAt(tr, t);
    if (!c) continue;
    if (tr.kind === 'video'){ if (!tr.hidden) video.push({ clip:c, track:tr }); }
    else if (!tr.muted) audio.push({ clip:c, track:tr });
  }
  return { video: video.reverse(), audio };   // last video track paints first (bottom)
}

/** Where in the source media does timeline time t fall for this clip? */
function sourceTime(clip, t){
  return round(clip.inPoint + (t - clip.start) * (clip.speed || 1));
}

/** Fade envelope, 0..1, at timeline time t. */
function gainAt(clip, t){
  let g = clip.volume == null ? 1 : clip.volume;
  const into = t - clip.start, left = endOf(clip) - t;
  if (clip.fadeIn  > 0 && into < clip.fadeIn)  g *= Math.max(0, into / clip.fadeIn);
  if (clip.fadeOut > 0 && left < clip.fadeOut) g *= Math.max(0, left / clip.fadeOut);
  return Math.max(0, g);
}

/** Opacity including video fades — same envelope, applied to alpha. */
function opacityAt(clip, t){
  const base = clip.transform ? (clip.transform.opacity == null ? 1 : clip.transform.opacity) : 1;
  const into = t - clip.start, left = endOf(clip) - t;
  let g = base;
  if (clip.fadeIn  > 0 && into < clip.fadeIn)  g *= Math.max(0, into / clip.fadeIn);
  if (clip.fadeOut > 0 && left < clip.fadeOut) g *= Math.max(0, left / clip.fadeOut);
  return Math.max(0, Math.min(1, g));
}

/** Candidate positions for snapping: clip edges on other tracks, plus 0. */
function snapPoints(p, excludeClipId){
  const pts = [0];
  for (const t of p.tracks)
    for (const c of t.clips){
      if (c.id === excludeClipId) continue;
      pts.push(c.start, endOf(c));
    }
  return pts;
}

function snap(value, points, tolerance){
  let best = value, bd = tolerance;
  for (const pt of points){
    const d = Math.abs(pt - value);
    if (d < bd){ bd = d; best = pt; }
  }
  return round(best);
}

/** Invariant check used by the tests and after risky edits. */
function validate(p){
  const errs = [];
  for (const t of p.tracks){
    const cs = t.clips.slice().sort((a,b) => a.start - b.start);
    for (let i = 0; i < cs.length; i++){
      const c = cs[i];
      if (c.start < -EPS) errs.push(c.id + ' starts before zero');
      if (c.duration <= 0) errs.push(c.id + ' has no duration');
      if (c.inPoint < -EPS) errs.push(c.id + ' has a negative in-point');
      if (c.sourceDuration != null &&
          c.inPoint + c.duration * (c.speed||1) > c.sourceDuration + 1e-3)
        errs.push(c.id + ' reads past the end of its source');
      if (i && endOf(cs[i-1]) > c.start + EPS)
        errs.push(cs[i-1].id + ' overlaps ' + c.id + ' on ' + t.name);
    }
  }
  return errs;
}

const API = {
  createProject, addTrack, removeTrack, addMedia, makeClip,
  place, appendClip, moveClip, trimClip, splitClip, splitAll, removeClip, rippleTrack,
  duration, clipAt, activeAt, sourceTime, gainAt, opacityAt,
  snapPoints, snap, findClip, trackOf, endOf, validate, uid, round,
};
if (typeof module === 'object' && module.exports) module.exports = API;
else root.Nle = API;

})(typeof self !== 'undefined' ? self : this);
