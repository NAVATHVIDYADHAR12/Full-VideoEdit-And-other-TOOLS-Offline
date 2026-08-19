/* dsp.js — noise reduction that actually analyses the signal.
 *
 * Method: STFT spectral subtraction.
 *   1. Chop the audio into overlapping windowed frames.
 *   2. FFT each frame to get its magnitude spectrum.
 *   3. Estimate the noise floor per frequency bin (from a sample the user marks,
 *      or automatically from the quietest frames in the file).
 *   4. Subtract that floor, keeping a small residual so the result does not
 *      turn into "musical noise" (chirpy artefacts).
 *   5. Inverse FFT and overlap-add back to a waveform.
 *
 * No dependencies. Runs on plain Float32Arrays so it is unit-testable in Node.
 */
(function (root) {
'use strict';

/* ---------------- radix-2 in-place FFT ---------------- */
function fft(re, im, inverse){
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++){          // bit-reversal permutation
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j){
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1){
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len){
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++){
        const ar = re[i+k],        ai = im[i+k];
        const br = re[i+k+len/2],  bi = im[i+k+len/2];
        const tr = br*cr - bi*ci,  ti = br*ci + bi*cr;
        re[i+k] = ar + tr;         im[i+k] = ai + ti;
        re[i+k+len/2] = ar - tr;   im[i+k+len/2] = ai - ti;
        const ncr = cr*wr - ci*wi;
        ci = cr*wi + ci*wr; cr = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++){ re[i] /= n; im[i] /= n; }
}

function hann(n){
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
  return w;
}

/* ---------------- spectral subtraction ---------------- */
/**
 * @param {Float32Array} input      mono samples, -1..1
 * @param {object} opt
 *   fftSize    2^k window length            (default 2048)
 *   amount     0..1 strength                (default 0.7)
 *   noiseFrom  [startSample, endSample] to learn the noise from, or null = auto
 *   floor      0..1 residual noise kept     (default 0.06 — stops musical noise)
 *   onProgress fn(0..1)
 * @returns {Float32Array} denoised samples, same length
 */
function denoise(input, opt){
  opt = opt || {};
  const N     = opt.fftSize || 2048;
  const hop   = N >> 2;                       // 75% overlap
  const amount= opt.amount == null ? 0.7 : opt.amount;
  const floor = opt.floor  == null ? 0.06 : opt.floor;
  const bins  = N / 2 + 1;
  const win   = hann(N);
  const len   = input.length;
  if (len < N) return input.slice();

  const frames = Math.max(1, Math.ceil((len - N) / hop) + 1);
  const mag    = new Float32Array(frames * bins);
  const phRe   = new Float32Array(frames * bins);
  const phIm   = new Float32Array(frames * bins);
  const energy = new Float32Array(frames);

  const re = new Float64Array(N), im = new Float64Array(N);

  /* ---- analysis ---- */
  for (let f = 0; f < frames; f++){
    const off = f * hop;
    for (let i = 0; i < N; i++){
      const s = off + i < len ? input[off + i] : 0;
      re[i] = s * win[i];
      im[i] = 0;
    }
    fft(re, im, false);
    let e = 0;
    for (let k = 0; k < bins; k++){
      const m = Math.hypot(re[k], im[k]);
      mag[f*bins + k] = m;
      phRe[f*bins + k] = re[k];
      phIm[f*bins + k] = im[k];
      e += m * m;
    }
    energy[f] = e;
  }

  /* ---- noise profile ---- */
  const noise = new Float32Array(bins);
  let learn = [];
  if (opt.noiseFrom){
    const a = Math.max(0, Math.floor((opt.noiseFrom[0] - 0) / hop));
    const b = Math.min(frames - 1, Math.ceil(opt.noiseFrom[1] / hop));
    for (let f = a; f <= b; f++) learn.push(f);
  }
  if (learn.length < 3){
    // auto: take the quietest 12% of frames — that is where the noise lives alone
    const order = Array.from({ length:frames }, (_, i) => i).sort((a,b) => energy[a] - energy[b]);
    learn = order.slice(0, Math.max(3, Math.round(frames * 0.12)));
  }
  for (const f of learn)
    for (let k = 0; k < bins; k++) noise[k] += mag[f*bins + k];
  for (let k = 0; k < bins; k++) noise[k] /= learn.length;

  /* ---- subtract + resynthesise ---- */
  const out = new Float32Array(len);
  const norm = new Float32Array(len);
  const over = 1 + amount * 2.2;              // over-subtraction factor

  for (let f = 0; f < frames; f++){
    for (let k = 0; k < bins; k++){
      const i = f*bins + k;
      const m = mag[i];
      if (m < 1e-12){ re[k] = im[k] = 0; continue; }
      const cleaned = Math.max(m - over * noise[k], floor * m);
      const g = cleaned / m;                  // gain to apply, phase untouched
      re[k] = phRe[i] * g;
      im[k] = phIm[i] * g;
    }
    for (let k = bins; k < N; k++){           // rebuild the conjugate half
      re[k] =  re[N - k];
      im[k] = -im[N - k];
    }
    fft(re, im, true);
    const off = f * hop;
    for (let i = 0; i < N; i++){
      const p = off + i;
      if (p >= len) break;
      out[p]  += re[i] * win[i];
      norm[p] += win[i] * win[i];
    }
    if (opt.onProgress && (f & 31) === 0) opt.onProgress(f / frames);
  }

  for (let i = 0; i < len; i++) if (norm[i] > 1e-8) out[i] /= norm[i];
  if (opt.onProgress) opt.onProgress(1);
  return out;
}

/* ---------------- extras ---------------- */

/** Simple one-pole high-pass — kills rumble, hum and handling noise. */
function highPass(x, sampleRate, cutoff){
  const out = new Float32Array(x.length);
  const rc = 1 / (2 * Math.PI * cutoff);
  const a = rc / (rc + 1 / sampleRate);
  let prevIn = x[0], prevOut = 0;
  for (let i = 0; i < x.length; i++){
    prevOut = a * (prevOut + x[i] - prevIn);
    prevIn = x[i];
    out[i] = prevOut;
  }
  return out;
}

/** Peak-normalise to the given ceiling (linear, e.g. 0.95). */
function normalize(x, ceiling){
  let peak = 0;
  for (let i = 0; i < x.length; i++){ const a = Math.abs(x[i]); if (a > peak) peak = a; }
  if (peak < 1e-6) return x;
  const g = (ceiling || 0.95) / peak;
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] * g;
  return out;
}

/** RMS in dBFS — used to report how much noise was actually removed. */
function rmsDb(x){
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return 10 * Math.log10(s / x.length + 1e-20);
}

const API = { fft, hann, denoise, highPass, normalize, rmsDb };
if (typeof module === 'object' && module.exports) module.exports = API;
else root.DSP = API;

})(typeof self !== 'undefined' ? self : this);
