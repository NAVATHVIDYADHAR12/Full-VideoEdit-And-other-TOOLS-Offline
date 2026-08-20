# Media & Document Toolkit

Ten video, audio and document tools that run entirely on your own machine. No uploads, no accounts,
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

## Deploying to Vercel

The app is fully static, so it deploys as-is:

1. Vercel → **Add New Project** → import this repo
2. Framework preset: **Other**. Leave build command and output directory empty.
3. Deploy.

`vercel.json` sends `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`, which make the page cross-origin isolated.
That is what unlocks `SharedArrayBuffer`, and therefore **multithreaded** ffmpeg. Without
those headers everything still works, just single-threaded and slower.

`vendor/` is excluded from the deployment via `.vercelignore`, so the hosted app loads the
ffmpeg engine from a CDN. That combination is safe here because both unpkg and jsDelivr send
`Cross-Origin-Resource-Policy: cross-origin`, which is exactly what `require-corp` demands —
verified against the live CDNs for all six engine files.

Note that even when hosted, **no video ever reaches the server**. Vercel only serves the HTML,
CSS and JS; all decoding, processing and encoding happens in the visitor's own browser.

## The tools

| Tool | What it does | Engine |
|---|---|---|
| **Video → JPG frames** | Every frame as a numbered JPEG, delivered as a ZIP. 30 fps default. Optional watermark removal baked into each frame. | pure JS |
| **Remove watermark from video** | Box the logo/timestamp, get a clean video out. Inpaint, blur, pixelate or crop. | ffmpeg |
| **Extract audio** | Soundtrack as WAV, MP3, M4A, or the original stream copied untouched. | WAV is pure JS |
| **Mute a video** | Strips the audio track. Video is stream-copied — lossless and near-instant. | ffmpeg |
| **Merge audio into video** | New soundtrack, replacing or mixed with the original. Video stream-copied. | ffmpeg |
| **Noise cancellation** | Removes hiss, hum and background roar from audio or a video's soundtrack. | pure JS |
| **Video editor** | A timeline NLE: media pool, multiple video/audio tracks, drag-drop, trim, split, transforms, colour filters, text, fades — rendered to MP4. | WebCodecs + ffmpeg |
| **Merge anything into one PDF** | Any number of PDFs, images, Word docs and text files, in your chosen order. | pure JS |
| **Merge Word documents** | Joins .docx files, carrying over text, images, lists and numbering. | pure JS |
| **Convert documents** | PDF → Word (two modes), PDF → images/text, Word → PDF, images → PDF. | pure JS |

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
The signal is padded by one window before analysis, otherwise the edge samples get partial
window coverage and the normalisation amplifies them into a burst of noise at the start of
the file. Measured on synthetic speech + hiss: **17–18 dB noise reduction for 0.3 dB signal
loss**, stable across runs, around 40× realtime. It runs in a Web Worker so the UI stays responsive.

**Mute** and **Merge** use `-c:v copy`, so the video is remuxed rather than re-encoded.
That means zero quality loss and near-instant completion regardless of video length.

**The video editor** keeps its timeline model (`js/nle-model.js`) free of DOM and media
APIs, so the parts that actually break — overwrite placement, source-bounded trimming,
splitting, cross-track rules — are unit-tested in Node rather than clicked at by hand.
Dropping a clip over another trims, splits or removes the host the way an NLE should;
trimming refuses to read past the end of the source or through a neighbour.

Preview and export share one compositor. Preview lets the video elements run and paints
whatever frame they are showing, which keeps playback smooth; export seeks every source to
an exact time first, so the render is deterministic and does not depend on machine speed.
Audio is mixed separately through an `OfflineAudioContext` with real fade envelopes, then
muxed in. Video encoding uses WebCodecs where the browser has it (H.264 straight out of the
browser, muxed by ffmpeg with `-c:v copy`) and falls back to a JPEG sequence through ffmpeg
otherwise — same result, slower.

**PDF to Word** comes in two modes because there is a genuine trade-off:

- **Editable text** rebuilds real document structure from the PDF's positioned glyphs and
  image XObjects. Paragraphs are recovered from line geometry, each run keeps its own
  bold/italic/size, embedded pictures are pulled out as real Word images, and column-aligned
  rows are rebuilt as real `<w:tbl>` tables. Everything is a genuine Word object you can
  click and edit.
  Position is preserved as far as Word allows. The output page is set to the PDF's real page
  size, pictures are emitted as *anchored* drawings pinned to their exact page coordinates
  (`<wp:anchor>` with `relativeFrom="page"`, not the inline drawings Word reflows), each
  paragraph keeps the left indent and the vertical gap measured in the PDF, and two-column
  pages are read down one column at a time rather than line-by-line across both. A "reflow"
  option is there if you would rather have an ordinary flowing document.

  This is a close match, not a pixel copy: Word is a flow layout engine, so text still
  reflows once you retype it. What cannot be recovered at all: vector drawings and text
  boxes, which a PDF stores as drawing commands rather than objects. And a **scanned PDF has
  no text inside it** — the words are pixels. The tool inspects the file first and says so
  rather than silently producing an empty document; that case needs OCR, which this app does
  not do.
- **Exact look** renders each page to an image and places it full-bleed in the document. It
  looks identical to the PDF, but the text cannot be edited or selected.

**Word to PDF** re-lays the content out rather than reproducing Word's exact pagination.
Headings, bold/italic, lists, tables and images survive; precise line breaks do not. The
built-in PDF fonts are Latin-only, so non-Latin characters are reported and replaced.

**Not supported, deliberately:** PowerPoint (.ppt/.pptx) and legacy .doc. Those need a real
Office engine such as LibreOffice, which cannot run in a browser. Save as PDF or .docx first.

**The DOCX layer** (`js/docx.js`) builds, reads and merges Word files directly against
ECMA-376 with no library. Merging remaps image relationship ids, shifts list-numbering ids
clear of collisions, and carries across styles the base document does not already define.
Output is validated against Windows' own OPC package reader — the same layer Word uses.

**The ZIP writer** is hand-written (store-only, since JPEGs are already compressed). Its
CRC32 is verified against zlib's and the output opens in Windows Explorer.

## Layout

```
index.html        markup for all nine tool panels
css/app.css       styles
js/core.js        shared: file pickers, ffmpeg loader, WAV codec, ZIP writer
js/zip.js         ZIP read/write (DOCX is a ZIP), via CompressionStream
js/docx.js        build / read / merge Word documents, no dependencies
js/docs.js        PDF layout engine, PDF text reconstruction, page rendering
js/doctools.js    the three document tool controllers
js/nle-model.js   timeline data model — pure logic, unit-tested
js/nle-render.js  media import, frame compositing, audio mixdown, export
js/nle-ui.js      the editor interface
js/dsp.js         FFT + spectral subtraction (dependency-free, unit-testable)
js/wm.js          watermark box editor + canvas removal + ffmpeg filter generation
js/tools.js       the six media tool controllers
lib/              pdf-lib, pdf.js, mammoth (2.6 MB, deployed with the app)
vendor/           ffmpeg.wasm, vendored so it works offline (~62 MB, local only)
server.js         static server that sends COOP/COEP for multithreading
```

## Known limits

- Frame extraction is seek-decode-encode per frame, roughly 10–20 fps of throughput.
  One minute of 30 fps video ≈ 1,800 JPEGs ≈ 2–3 minutes.
- Asking for 30 fps from a 24 fps source gives duplicated frames. That's inherent.
- A watermark that moves needs a box covering its full range of motion.
- Very large videos are held in browser memory; multi-GB files may run out.
- PDF → Word cannot recover vector drawings or text boxes; scanned PDFs need OCR.
- PowerPoint and legacy .doc are not supported at all.
- The built-in PDF fonts cover Latin only; other scripts become "?" and are reported.
- Editor preview syncs video elements rather than seeking per frame, so it drifts slightly
  on very short clips. The export is frame-accurate regardless.
- Editor export renders every frame through a canvas, so long timelines take a while.
- No transitions between clips yet, and no keyframed animation.
