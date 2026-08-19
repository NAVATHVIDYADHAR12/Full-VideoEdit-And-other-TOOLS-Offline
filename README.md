# Video Toolkit

Six video/audio tools that run entirely on your own machine. No uploads, no accounts,
no server round-trips — your files never leave the computer.

## Setup after cloning

```bash
node fetch-vendor.js     # downloads the ffmpeg.wasm engine (~62 MB) into vendor/
```

Optional but recommended. Those files are compiled binaries, so they aren't stored in git.
Skip this and the app still works — it falls back to loading ffmpeg from a CDN, which needs
internet each session and starts more slowly.

## Running it

**Recommended — double-click `start.bat`.**
This starts a tiny local server and opens the app. It's the better way to run it because:

- ffmpeg runs **multithreaded** (several times faster on video jobs)
- the ffmpeg engine loads from the local `vendor/` folder, so it works **fully offline**

You can also just double-click `index.html`. Everything still works, but the ffmpeg-based
tools will download the engine from the internet each session and run single-threaded.

Requires [Node.js](https://nodejs.org) for `start.bat` only. The app itself is plain
browser JavaScript.

## The tools

| Tool | What it does | Engine |
|---|---|---|
| **Video → JPG frames** | Every frame as a numbered JPEG, delivered as a ZIP. 30 fps default. Optional watermark removal baked into each frame. | pure JS |
| **Remove watermark from video** | Box the logo/timestamp, get a clean video out. Inpaint, blur, pixelate or crop. | ffmpeg |
| **Extract audio** | Soundtrack as WAV, MP3, M4A, or the original stream copied untouched. | WAV is pure JS |
| **Mute a video** | Strips the audio track. Video is stream-copied — lossless and near-instant. | ffmpeg |
| **Merge audio into video** | New soundtrack, replacing or mixed with the original. Video stream-copied. | ffmpeg |
| **Noise cancellation** | Removes hiss, hum and background roar from audio or a video's soundtrack. | pure JS |

## How the interesting bits work

**Watermark removal** offers four methods because no single one is honest for every case:

- **Inpaint** solves a Laplace equation over the boxed region — the hole is replaced by a
  smooth surface pinned to the pixels around it. Measured error against a known background:
  0.0/255 on flat colour, 0.7 on gradients, 1.5 on soft blur, but ~30/255 on fine texture.
  Nothing in a browser can recover detail the watermark is covering; on busy footage the
  result is a visible smudge.
- **Blur** / **Pixelate** always work, but hide rather than remove.
- **Crop** cuts the pixels away entirely — the only genuinely clean option over detailed
  backgrounds. Keeps the largest rectangle that excludes every box.

**Noise cancellation** is STFT spectral subtraction: the audio is chopped into overlapping
windows, FFT'd, a per-frequency noise floor is estimated (from a stretch you mark on the
waveform, or automatically from the quietest 12% of frames), that floor is subtracted with a
small residual left in to avoid "musical noise", then it's resynthesised by overlap-add.
Measured on synthetic speech + hiss: **16.6 dB noise reduction for 0.3 dB signal loss**,
around 40× realtime. It runs in a Web Worker so the UI stays responsive.

**Mute** and **Merge** use `-c:v copy`, so the video is remuxed rather than re-encoded.
That means zero quality loss and near-instant completion regardless of video length.

**The ZIP writer** is hand-written (store-only, since JPEGs are already compressed). Its
CRC32 is verified against zlib's and the output opens in Windows Explorer.

## Layout

```
index.html        markup for all six tool panels
css/app.css       styles
js/core.js        shared: file pickers, ffmpeg loader, WAV codec, ZIP writer
js/dsp.js         FFT + spectral subtraction (dependency-free, unit-testable)
js/wm.js          watermark box editor + canvas removal + ffmpeg filter generation
js/tools.js       the six tool controllers
vendor/           ffmpeg.wasm, vendored so it works offline (~65 MB)
server.js         static server that sends COOP/COEP for multithreading
```

## Known limits

- Frame extraction is seek-decode-encode per frame, roughly 10–20 fps of throughput.
  One minute of 30 fps video ≈ 1,800 JPEGs ≈ 2–3 minutes.
- Asking for 30 fps from a 24 fps source gives duplicated frames. That's inherent.
- A watermark that moves needs a box covering its full range of motion.
- Very large videos are held in browser memory; multi-GB files may run out.
