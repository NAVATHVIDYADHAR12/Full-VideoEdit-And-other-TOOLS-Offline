/* Tiny static server for the Video Toolkit.
 *
 * Why bother instead of double-clicking index.html?
 *   - It sends COOP/COEP headers, which switch on SharedArrayBuffer, which lets
 *     ffmpeg.wasm run MULTITHREADED (several times faster on video jobs).
 *   - fetch() of the local vendor/*.wasm files is blocked on file:// URLs, so
 *     serving over http is what makes the offline ffmpeg copy usable at all.
 *
 * Usage:  node server.js  [port]
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.argv[2]) || 8123;

const MIME = {
  '.html':'text/html; charset=utf-8',
  '.js'  :'text/javascript; charset=utf-8',
  '.css' :'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.wasm':'application/wasm',
  '.png' :'image/png',
  '.svg' :'image/svg+xml',
  '.ico' :'image/x-icon',
  /* Audio and video are strict about this in a way images are not: a browser
     will happily sniff an octet-stream into an <img>, but <audio> refuses to
     decode one, which is exactly how the hero riser came to be silent. */
  '.mp3' :'audio/mpeg',
  '.wav' :'audio/wav',
  '.m4a' :'audio/mp4',
  '.ogg' :'audio/ogg',
  '.mp4' :'video/mp4',
  '.webm':'video/webm',
  '.jpg' :'image/jpeg',
  '.jpeg':'image/jpeg',
  '.webp':'image/webp',
  '.gif' :'image/gif',
  '.woff2':'font/woff2',
  '.woff':'font/woff',
  '.txt' :'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';

  // never serve anything outside the project folder
  const file = path.join(ROOT, path.normalize(rel).replace(/^[/\\]+/, ''));
  if (!file.startsWith(ROOT)){
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()){
      res.writeHead(404, { 'Content-Type':'text/plain' }).end('Not found: ' + rel);
      return;
    }

    const headers = {
      'Content-Type'  : MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control' : 'no-cache',
      // these two are what enable SharedArrayBuffer -> multithreaded ffmpeg.wasm
      'Cross-Origin-Opener-Policy'  : 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    };

    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, () => {
  const url = 'http://localhost:' + PORT + '/';
  console.log('\n  Video Toolkit running at  ' + url);
  console.log('  Multithreaded ffmpeg: enabled (COOP/COEP headers are being sent)');
  console.log('  Press Ctrl+C to stop.\n');

  // open the default browser (Windows / macOS / Linux)
  const { exec } = require('child_process');
  const cmd = process.platform === 'win32' ? 'start ""'
            : process.platform === 'darwin' ? 'open' : 'xdg-open';
  exec(cmd + ' ' + url, () => {});
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE'){
    console.error('\n  Port ' + PORT + ' is busy. Try:  node server.js ' + (PORT + 1) + '\n');
  } else {
    console.error(e);
  }
  process.exit(1);
});
