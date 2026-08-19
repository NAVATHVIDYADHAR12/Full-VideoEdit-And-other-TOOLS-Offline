/* wm.js — watermark box editor + per-frame removal.
 *
 * Used by two tools: "Video -> JPG frames" (canvas removal, baked into each JPG)
 * and "Remove watermark -> video" (the boxes become ffmpeg filter arguments).
 *
 * Boxes are stored NORMALISED (0..1) so they survive any downscale, and map
 * cleanly onto both a canvas and an ffmpeg -vf expression.
 */
(function (root) {
'use strict';
const { seek } = root.Core;

const MODE_HINT = {
  inpaint : 'Best on soft or plain backgrounds (sky, blur, gradients). Mushy over fine detail.',
  blur    : 'Always works. The watermark is hidden, not recovered.',
  pixelate: 'Always works. Obvious but tidy.',
  crop    : 'Truly gone — the pixels are cut away. Costs you frame area.'
};

/**
 * @param {object} o
 *   root      container element holding the editor markup
 *   video     <video> element to pull preview frames from
 *   onChange  called whenever boxes/mode/params change
 *   modes     which methods to offer (default all four)
 */
function create(o){
  const S = {
    boxes: [], sel: -1, mode: 'inpaint', strength: 14, feather: 6,
    ready: false, showResult: true
  };

  const q = sel => o.root.querySelector(sel);
  const cv        = q('[data-wm=canvas]');
  const seekEl    = q('[data-wm=seek]');
  const timeEl    = q('[data-wm=time]');
  const modeEl    = q('[data-wm=mode]');
  const strEl     = q('[data-wm=strength]');
  const fthEl     = q('[data-wm=feather]');
  const showEl    = q('[data-wm=show]');
  const chipsEl   = q('[data-wm=boxes]');
  const noteEl    = q('[data-wm=note]');
  const sValEl    = q('[data-wm=sval]');
  const fValEl    = q('[data-wm=fval]');
  const modeHint  = q('[data-wm=modehint]');
  const strHint   = q('[data-wm=strhint]');

  const frame = document.createElement('canvas');    // clean preview frame
  let ctx2d = null, busy = false, want = null;

  /* ---------- controls ---------- */
  modeEl.onchange = () => {
    S.mode = modeEl.value;
    modeHint.textContent = MODE_HINT[S.mode];
    strEl.disabled = S.mode === 'crop' || S.mode === 'inpaint';
    fthEl.disabled = S.mode === 'crop';
    strHint.textContent = S.mode === 'blur' ? 'Blur radius in pixels'
      : S.mode === 'pixelate' ? 'Mosaic block size'
      : S.mode === 'inpaint' ? 'Not used by inpaint' : 'Not used by crop';
    render(); changed();
  };
  strEl.oninput = () => { S.strength = +strEl.value; sValEl.textContent = S.strength; render(); };
  fthEl.oninput = () => { S.feather  = +fthEl.value; fValEl.textContent = S.feather;  render(); };
  showEl.onchange = () => { S.showResult = showEl.checked; render(); };
  q('[data-wm=clear]').onclick = () => { S.boxes = []; S.sel = -1; render(); changed(); };
  q('[data-wm=del]').onclick   = () => { if (S.sel >= 0){ S.boxes.splice(S.sel,1); S.sel = -1; render(); changed(); } };
  seekEl.oninput = () => { timeEl.textContent = (+seekEl.value).toFixed(2); grab(+seekEl.value); };

  window.addEventListener('keydown', e => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.ready && S.sel >= 0 &&
        o.root.offsetParent !== null && e.target.tagName !== 'INPUT'){
      e.preventDefault(); q('[data-wm=del]').click();
    }
  });

  function changed(){ if (o.onChange) o.onChange(); }

  /* ---------- lifecycle ---------- */
  function init(){
    const v = o.video();
    const W = Math.min(v.videoWidth || 640, 800);
    const H = Math.round((v.videoHeight || 360) * W / (v.videoWidth || 640));
    frame.width = W; frame.height = H;
    cv.width = W; cv.height = H;
    ctx2d = cv.getContext('2d');
    seekEl.max = v.duration.toFixed(2);
    seekEl.step = Math.max(0.01, v.duration / 500).toFixed(2);
    modeEl.onchange();
    S.ready = true;
    grab(Math.min(v.duration * 0.25, v.duration));
  }
  function reset(){ S.boxes = []; S.sel = -1; S.ready = false; }

  async function grab(t){
    want = t;
    if (busy) return;
    busy = true;
    try {
      while (want !== null){
        const target = want; want = null;
        const v = o.video();
        await seek(v, target);
        frame.getContext('2d').drawImage(v, 0, 0, frame.width, frame.height);
        seekEl.value = target.toFixed(2);
        timeEl.textContent = target.toFixed(2);
        render();
      }
    } catch(_){ /* scrubbing is best-effort */ }
    finally { busy = false; }
  }

  /* ---------- rendering ---------- */
  function render(){
    if (!S.ready || !ctx2d) return;
    const W = cv.width, H = cv.height;
    ctx2d.clearRect(0,0,W,H);
    ctx2d.drawImage(frame, 0, 0);

    if (S.showResult && S.boxes.length){
      if (S.mode === 'crop'){
        const c = cropRect(W,H);
        ctx2d.save();
        ctx2d.fillStyle = 'rgba(0,0,0,.72)';
        ctx2d.beginPath(); ctx2d.rect(0,0,W,H); ctx2d.rect(c.x,c.y,c.w,c.h); ctx2d.fill('evenodd');
        ctx2d.strokeStyle = '#3fb950'; ctx2d.lineWidth = 2;
        ctx2d.strokeRect(c.x+1, c.y+1, c.w-2, c.h-2);
        ctx2d.restore();
      } else {
        apply(ctx2d, W, H);
      }
    }

    S.boxes.forEach((b,i) => {
      const r = px(b,W,H), on = i === S.sel;
      ctx2d.save();
      ctx2d.strokeStyle = on ? '#4f8cff' : 'rgba(255,255,255,.85)';
      ctx2d.lineWidth = on ? 3 : 2;
      ctx2d.setLineDash(on ? [] : [7,5]);
      ctx2d.strokeRect(r.x, r.y, r.w, r.h);
      ctx2d.setLineDash([]);
      ctx2d.fillStyle = on ? '#4f8cff' : 'rgba(255,255,255,.85)';
      ctx2d.fillRect(r.x + r.w - 9, r.y + r.h - 9, 9, 9);
      ctx2d.restore();
    });

    chips();
    noteEl.className = 'note' + (S.boxes.length ? '' : ' ok');
    noteEl.innerHTML = !S.boxes.length
      ? 'Scrub to a frame where the watermark is visible, then drag a box around it.'
      : (S.mode === 'crop'
          ? 'Crop keeps the largest rectangle that excludes every box.'
          : 'A watermark that <b>moves or fades</b> needs a box big enough to cover it everywhere, on every frame.');
  }

  function chips(){
    chipsEl.innerHTML = '';
    S.boxes.forEach((b,i) => {
      const d = document.createElement('div');
      d.className = 'chip' + (i === S.sel ? ' sel' : '');
      d.textContent = 'Box ' + (i+1) + ' · ' + Math.round(b.w*100) + '%×' + Math.round(b.h*100) + '%';
      const x = document.createElement('button');
      x.textContent = '×'; x.title = 'Remove';
      x.onclick = ev => { ev.stopPropagation(); S.boxes.splice(i,1); S.sel = -1; render(); changed(); };
      d.appendChild(x);
      d.onclick = () => { S.sel = i; render(); };
      chipsEl.appendChild(d);
    });
  }

  const px = (b,W,H) => ({ x:b.x*W, y:b.y*H, w:b.w*W, h:b.h*H });

  /* ---------- pointer: draw / move / resize ---------- */
  let drag = null;
  const pos = e => {
    const r = cv.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return { x:(p.clientX - r.left)/r.width, y:(p.clientY - r.top)/r.height };
  };
  function down(e){
    if (!S.ready) return;
    e.preventDefault();
    const p = pos(e), hx = 14/cv.width, hy = 14/cv.height;
    for (let i = S.boxes.length-1; i >= 0; i--){
      const b = S.boxes[i];
      if (Math.abs(p.x-(b.x+b.w)) < hx && Math.abs(p.y-(b.y+b.h)) < hy){
        S.sel = i; drag = { mode:'resize', i }; render(); return;
      }
      if (p.x > b.x && p.x < b.x+b.w && p.y > b.y && p.y < b.y+b.h){
        S.sel = i; drag = { mode:'move', i, dx:p.x-b.x, dy:p.y-b.y }; render(); return;
      }
    }
    S.boxes.push({ x:p.x, y:p.y, w:0, h:0 });
    S.sel = S.boxes.length-1;
    drag = { mode:'new', i:S.sel, ox:p.x, oy:p.y };
  }
  function move(e){
    if (!drag) return;
    e.preventDefault();
    const p = pos(e), b = S.boxes[drag.i], cl = v => Math.max(0, Math.min(1, v));
    if (drag.mode === 'new'){
      b.x = cl(Math.min(drag.ox,p.x)); b.y = cl(Math.min(drag.oy,p.y));
      b.w = cl(Math.max(drag.ox,p.x)) - b.x; b.h = cl(Math.max(drag.oy,p.y)) - b.y;
    } else if (drag.mode === 'move'){
      b.x = cl(Math.min(p.x-drag.dx, 1-b.w));
      b.y = cl(Math.min(p.y-drag.dy, 1-b.h));
    } else {
      b.w = Math.max(0.004, cl(p.x)-b.x);
      b.h = Math.max(0.004, cl(p.y)-b.y);
    }
    render();
  }
  function up(){
    if (!drag) return;
    const b = S.boxes[drag.i];
    if (b && (b.w < 0.006 || b.h < 0.006)){ S.boxes.splice(drag.i,1); S.sel = -1; }
    drag = null;
    render(); changed();
  }
  cv.addEventListener('mousedown', down);
  cv.addEventListener('touchstart', down, { passive:false });
  window.addEventListener('mousemove', move);
  window.addEventListener('touchmove', move, { passive:false });
  window.addEventListener('mouseup', up);
  window.addEventListener('touchend', up);

  /* ================= canvas removal ================= */
  const scratch = document.createElement('canvas');

  function apply(ctx, W, H){
    if (!S.boxes.length || S.mode === 'crop') return;
    scratch.width = W; scratch.height = H;
    scratch.getContext('2d', { alpha:false }).drawImage(ctx.canvas, 0, 0);

    const grow = S.mode === 'inpaint' ? S.feather : 0;
    for (const b of S.boxes){
      const p0 = px(b,W,H);
      const r = {
        x: Math.max(0, Math.floor(p0.x - grow)),
        y: Math.max(0, Math.floor(p0.y - grow)),
        x2: Math.min(W, Math.ceil(p0.x + p0.w + grow)),
        y2: Math.min(H, Math.ceil(p0.y + p0.h + grow)),
      };
      r.w = r.x2 - r.x; r.h = r.y2 - r.y;
      if (r.w < 2 || r.h < 2) continue;
      const patch = S.mode === 'inpaint' ? patchInpaint(scratch, r)
                  : S.mode === 'blur'    ? patchBlur(scratch, r)
                                         : patchPixelate(scratch, r);
      composite(ctx, patch, r, S.feather);
    }
  }

  /* Laplace fill: the hole becomes a smooth surface pinned to the pixels around it.
     Solved on a downscaled copy — the answer is smooth anyway, so nothing is lost. */
  function patchInpaint(src, r){
    const pad = Math.max(3, Math.round(Math.max(r.w,r.h) * 0.3));
    const rx = Math.max(0, r.x - pad), ry = Math.max(0, r.y - pad);
    const rw = Math.min(src.width,  r.x + r.w + pad) - rx;
    const rh = Math.min(src.height, r.y + r.h + pad) - ry;

    const sc = Math.min(1, 56 / Math.max(rw, rh));
    const sw = Math.max(4, Math.round(rw*sc)), sh = Math.max(4, Math.round(rh*sc));

    const small = document.createElement('canvas');
    small.width = sw; small.height = sh;
    const sctx = small.getContext('2d', { willReadFrequently:true });
    sctx.drawImage(src, rx, ry, rw, rh, 0, 0, sw, sh);

    const img = sctx.getImageData(0,0,sw,sh), d = img.data;
    const bx0 = Math.floor((r.x-rx)*sw/rw), by0 = Math.floor((r.y-ry)*sh/rh);
    const bx1 = Math.ceil((r.x+r.w-rx)*sw/rw), by1 = Math.ceil((r.y+r.h-ry)*sh/rh);

    const n = sw*sh, mask = new Uint8Array(n);
    for (let j = by0; j < by1; j++)
      for (let i = bx0; i < bx1; i++)
        if (i>=0 && i<sw && j>=0 && j<sh) mask[j*sw+i] = 1;

    let sr=0, sg=0, sb=0, cnt=0;
    for (let k = 0; k < n; k++){
      if (mask[k]) continue;
      const i = k%sw, j = (k/sw)|0;
      if (i<bx0-2 || i>bx1+1 || j<by0-2 || j>by1+1) continue;
      sr += d[k*4]; sg += d[k*4+1]; sb += d[k*4+2]; cnt++;
    }
    if (!cnt){ sr = sg = sb = 128; cnt = 1; }

    const cur = new Float32Array(n*3), nxt = new Float32Array(n*3);
    for (let k = 0; k < n; k++){
      if (mask[k]){ cur[k*3]=sr/cnt; cur[k*3+1]=sg/cnt; cur[k*3+2]=sb/cnt; }
      else { cur[k*3]=d[k*4]; cur[k*3+1]=d[k*4+1]; cur[k*3+2]=d[k*4+2]; }
    }
    nxt.set(cur);

    for (let it = 0; it < 260; it++){
      for (let j = 0; j < sh; j++){
        for (let i = 0; i < sw; i++){
          const k = j*sw+i;
          if (!mask[k]) continue;
          const l = i>0 ? k-1 : k, rr = i<sw-1 ? k+1 : k;
          const u = j>0 ? k-sw : k, dn = j<sh-1 ? k+sw : k;
          for (let c = 0; c < 3; c++)
            nxt[k*3+c] = (cur[l*3+c] + cur[rr*3+c] + cur[u*3+c] + cur[dn*3+c]) * 0.25;
        }
      }
      cur.set(nxt);
    }

    for (let k = 0; k < n; k++){
      if (!mask[k]) continue;
      d[k*4]=cur[k*3]; d[k*4+1]=cur[k*3+1]; d[k*4+2]=cur[k*3+2]; d[k*4+3]=255;
    }
    sctx.putImageData(img, 0, 0);

    const patch = document.createElement('canvas');
    patch.width = r.w; patch.height = r.h;
    const pctx = patch.getContext('2d');
    pctx.imageSmoothingEnabled = true;
    pctx.imageSmoothingQuality = 'high';
    pctx.drawImage(small, (r.x-rx)*sw/rw, (r.y-ry)*sh/rh, r.w*sw/rw, r.h*sh/rh, 0, 0, r.w, r.h);
    return patch;
  }

  function patchBlur(src, r){
    const m = Math.ceil(S.strength*2);
    const t = document.createElement('canvas');
    t.width = r.w + m*2; t.height = r.h + m*2;
    const tc = t.getContext('2d');
    tc.fillStyle = edgeColor(src, r);
    tc.fillRect(0,0,t.width,t.height);
    tc.drawImage(src, m - r.x, m - r.y);
    const out = document.createElement('canvas');
    out.width = r.w; out.height = r.h;
    const oc = out.getContext('2d');
    oc.filter = 'blur(' + S.strength + 'px)';
    oc.drawImage(t, -m, -m);
    return out;
  }

  function patchPixelate(src, r){
    const s = Math.max(2, S.strength);
    const sw = Math.max(1, Math.round(r.w/s)), sh = Math.max(1, Math.round(r.h/s));
    const t = document.createElement('canvas');
    t.width = sw; t.height = sh;
    t.getContext('2d').drawImage(src, r.x, r.y, r.w, r.h, 0, 0, sw, sh);
    const out = document.createElement('canvas');
    out.width = r.w; out.height = r.h;
    const oc = out.getContext('2d');
    oc.imageSmoothingEnabled = false;
    oc.drawImage(t, 0, 0, sw, sh, 0, 0, r.w, r.h);
    return out;
  }

  function edgeColor(src, r){
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const cx = c.getContext('2d', { willReadFrequently:true });
    cx.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, 1, 1);
    const p = cx.getImageData(0,0,1,1).data;
    return 'rgb(' + p[0] + ',' + p[1] + ',' + p[2] + ')';
  }

  function composite(ctx, patch, r, feather){
    const f = Math.min(feather, Math.floor(Math.min(r.w,r.h)/2) - 1);
    if (f > 0){
      const mask = document.createElement('canvas');
      mask.width = r.w; mask.height = r.h;
      const mc = mask.getContext('2d');
      mc.filter = 'blur(' + (f/2) + 'px)';
      mc.fillStyle = '#fff';
      mc.fillRect(f, f, r.w - f*2, r.h - f*2);
      const pc = patch.getContext('2d');
      pc.filter = 'none';
      pc.globalCompositeOperation = 'destination-in';
      pc.drawImage(mask, 0, 0);
      pc.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(patch, r.x, r.y);
  }

  /* Largest rectangle excluding every box — trim the cheapest edge each time. */
  function cropRect(W, H){
    let t = 0, b = H, l = 0, rt = W;
    for (const bx of S.boxes){
      const x0 = bx.x*W, y0 = bx.y*H, x1 = x0 + bx.w*W, y1 = y0 + bx.h*H;
      if (x1 <= l || x0 >= rt || y1 <= t || y0 >= b) continue;
      const opts = [[y1-t,'t'],[b-y0,'b'],[x1-l,'l'],[rt-x0,'r']].sort((a,c) => a[0]-c[0]);
      const side = opts[0][1];
      if (side === 't') t = Math.min(y1,b);
      else if (side === 'b') b = Math.max(y0,t);
      else if (side === 'l') l = Math.min(x1,rt);
      else rt = Math.max(x0,l);
    }
    return { x:Math.round(l), y:Math.round(t),
             w:Math.max(2, Math.round(rt-l)), h:Math.max(2, Math.round(b-t)) };
  }

  /* ================= ffmpeg filter chain =================
   * Same boxes, expressed as a -vf expression so a whole video can be processed. */
  function filterChain(W, H){
    if (!S.boxes.length) return null;
    const even = v => Math.round(v/2)*2;   // h.264 needs even dimensions

    if (S.mode === 'crop'){
      const c = cropRect(W,H);
      // offsets may legitimately be 0 — only the width/height have a minimum,
      // and the region must stay inside the frame or ffmpeg rejects it
      const x = Math.max(0, Math.min(even(c.x), W - 2));
      const y = Math.max(0, Math.min(even(c.y), H - 2));
      const w = Math.max(2, even(Math.min(c.w, W - x)));
      const h = Math.max(2, even(Math.min(c.h, H - y)));
      return 'crop=' + w + ':' + h + ':' + x + ':' + y;
    }

    const rects = S.boxes.map(b => {
      const x = Math.max(1, Math.round(b.x*W)), y = Math.max(1, Math.round(b.y*H));
      const w = Math.max(2, Math.round(b.w*W)), h = Math.max(2, Math.round(b.h*H));
      // delogo needs at least 1px of surrounding image to interpolate from
      return {
        x, y,
        w: Math.min(w, W - x - 1),
        h: Math.min(h, H - y - 1)
      };
    }).filter(r => r.w >= 2 && r.h >= 2);
    if (!rects.length) return null;

    if (S.mode === 'inpaint')
      return rects.map(r => 'delogo=x=' + r.x + ':y=' + r.y + ':w=' + r.w + ':h=' + r.h).join(',');

    // blur / pixelate: cut the region out, process it, paste it back with overlay
    const parts = [];
    let label = '[0:v]', idx = 0;
    rects.forEach(r => {
      const cut = 'c' + idx, don = 'd' + idx, out = 'o' + idx;
      const proc = S.mode === 'blur'
        ? 'boxblur=' + Math.max(2, Math.round(S.strength/2)) + ':1'
        : 'scale=' + Math.max(2, Math.round(r.w / Math.max(2,S.strength))) + ':' +
                     Math.max(2, Math.round(r.h / Math.max(2,S.strength))) +
          ',scale=' + r.w + ':' + r.h + ':flags=neighbor';
      parts.push(label + 'split[m' + idx + '][s' + idx + ']');
      parts.push('[s' + idx + ']crop=' + r.w + ':' + r.h + ':' + r.x + ':' + r.y + ',' + proc + '[' + don + ']');
      parts.push('[m' + idx + '][' + don + ']overlay=' + r.x + ':' + r.y + '[' + out + ']');
      label = '[' + out + ']';
      idx++;
    });
    return { complex: parts.join(';'), out: label };
  }

  return {
    state: S, init, reset, render, grab, apply, cropRect, filterChain,
    get boxes(){ return S.boxes; },
    get mode(){ return S.mode; },
    hasBoxes(){ return S.boxes.length > 0; },
  };
}

/** The markup an editor instance expects. Injected by each tool. */
function markup(){
  return '' +
  '<div class="wmstage"><canvas data-wm="canvas"></canvas></div>' +
  '<div class="status" style="margin-bottom:14px"><span>Drag on the frame to box the watermark. ' +
    'Click a box to select, drag to move, drag its corner to resize.</span></div>' +
  '<label>Preview frame — <b data-wm="time">0.00</b>s</label>' +
  '<input type="range" data-wm="seek" min="0" max="100" value="0" step="0.1">' +
  '<div class="grid" style="margin-top:16px">' +
    '<div><label>Method</label>' +
      '<select data-wm="mode">' +
        '<option value="inpaint">Inpaint — fill from surroundings</option>' +
        '<option value="blur">Blur it out</option>' +
        '<option value="pixelate">Pixelate it out</option>' +
        '<option value="crop">Crop it off</option>' +
      '</select><div class="hint" data-wm="modehint"></div></div>' +
    '<div><label>Strength — <b data-wm="sval">14</b></label>' +
      '<input type="range" data-wm="strength" min="2" max="40" value="14" step="1">' +
      '<div class="hint" data-wm="strhint"></div></div>' +
    '<div><label>Edge feather — <b data-wm="fval">6</b>px</label>' +
      '<input type="range" data-wm="feather" min="0" max="24" value="6" step="1">' +
      '<div class="hint">Softens the seam so the patch blends in</div></div>' +
  '</div>' +
  '<div class="boxlist" data-wm="boxes"></div>' +
  '<div class="row" style="margin-top:14px">' +
    '<label class="toggle"><input type="checkbox" data-wm="show" checked> Show result</label>' +
    '<button type="button" class="ghost sm" data-wm="del">Delete selected</button>' +
    '<button type="button" class="ghost sm" data-wm="clear">Clear all boxes</button>' +
  '</div>' +
  '<div class="note" data-wm="note" style="margin-top:14px"></div>';
}

root.WM = { create, markup, MODE_HINT };

})(window);
