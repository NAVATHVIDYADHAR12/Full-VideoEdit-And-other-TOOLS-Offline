/* fetch-vendor.js — downloads the ffmpeg.wasm engine into vendor/.
 *
 * These files are ~62 MB of compiled binaries, so they are not stored in git.
 * The app works without them (it falls back to the CDN), but running this once
 * makes the ffmpeg tools work fully offline and start faster.
 *
 * Usage:  node fetch-vendor.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const DIR = path.join(__dirname, 'vendor');
const U = 'https://unpkg.com/@ffmpeg/';

const FILES = [
  ['ffmpeg@0.12.10/dist/umd/ffmpeg.js',            'ffmpeg.js'],
  ['ffmpeg@0.12.10/dist/umd/814.ffmpeg.js',        '814.ffmpeg.js'],
  ['util@0.12.1/dist/umd/index.js',                'ffmpeg-util.js'],
  ['core@0.12.6/dist/umd/ffmpeg-core.js',          'ffmpeg-core.js'],
  ['core@0.12.6/dist/umd/ffmpeg-core.wasm',        'ffmpeg-core.wasm'],
  ['core-mt@0.12.6/dist/umd/ffmpeg-core.js',       'ffmpeg-core-mt.js'],
  ['core-mt@0.12.6/dist/umd/ffmpeg-core.wasm',     'ffmpeg-core-mt.wasm'],
  ['core-mt@0.12.6/dist/umd/ffmpeg-core.worker.js','ffmpeg-core-mt.worker.js'],
];

function get(url, dest){
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return resolve(get(res.headers.location, dest));
      if (res.statusCode !== 200)
        return reject(new Error(res.statusCode + ' for ' + url));

      const total = Number(res.headers['content-length']) || 0;
      let got = 0;
      const out = fs.createWriteStream(dest);
      res.on('data', c => {
        got += c.length;
        if (total > 10e6)
          process.stdout.write('\r  ' + path.basename(dest) + '  ' +
            (got/1048576).toFixed(1) + ' / ' + (total/1048576).toFixed(1) + ' MB   ');
      });
      res.pipe(out);
      out.on('finish', () => { out.close(() => resolve(got)); });
      out.on('error', reject);
    }).on('error', reject);
  });
}

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  console.log('Downloading the ffmpeg.wasm engine into vendor/ …\n');
  for (const [remote, local] of FILES){
    const dest = path.join(DIR, local);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0){
      console.log('  have  ' + local);
      continue;
    }
    const n = await get(U + remote, dest);
    console.log('\r  done  ' + local + '  (' + (n/1048576).toFixed(1) + ' MB)          ');
  }
  console.log('\nReady. Run start.bat to launch the toolkit.');
})().catch(e => {
  console.error('\nDownload failed: ' + e.message);
  console.error('The app still works — it will load ffmpeg from the CDN instead.');
  process.exit(1);
});
