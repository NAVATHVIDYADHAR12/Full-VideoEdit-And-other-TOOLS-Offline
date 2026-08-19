/* zip.js — read and write ZIP archives with no dependencies.
 *
 * DOCX, XLSX and PPTX are all just ZIPs full of XML, so this is what makes the
 * document tools possible. Deflate/inflate come from the browser's own
 * CompressionStream / DecompressionStream, so nothing needs to be bundled.
 */
(function (root) {
'use strict';

const SIG_LOCAL   = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD    = 0x06054b50;

/* ---------- CRC32 ---------- */
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++){
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes){
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* ---------- raw deflate helpers ---------- */
async function streamThrough(bytes, stream){
  const rs = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(rs).arrayBuffer());
}
const inflateRaw = bytes => streamThrough(bytes, new DecompressionStream('deflate-raw'));
const deflateRaw = bytes => streamThrough(bytes, new CompressionStream('deflate-raw'));

/* ---------- read ---------- */
/**
 * @param {ArrayBuffer|Uint8Array} input
 * @returns {Promise<Map<string, Uint8Array>>} filename -> contents
 */
async function read(input){
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // the end-of-central-directory record lives in the last 64KB
  let eocd = -1;
  const from = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= from; i--){
    if (dv.getUint32(i, true) === SIG_EOCD){ eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a ZIP file (no end-of-central-directory record).');

  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);

  const dec = new TextDecoder();
  const out = new Map();

  for (let i = 0; i < count; i++){
    if (dv.getUint32(off, true) !== SIG_CENTRAL) break;
    const method   = dv.getUint16(off + 10, true);
    const compSize = dv.getUint32(off + 20, true);
    const nameLen  = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const cmtLen   = dv.getUint16(off + 32, true);
    const localOff = dv.getUint32(off + 42, true);
    // The spec mandates '/' as the separator, but some writers (Windows'
    // Compress-Archive among them) emit '\'. Normalise, or lookups like
    // "word/document.xml" silently miss.
    const name = dec.decode(buf.subarray(off + 46, off + 46 + nameLen)).replace(/\\/g, '/');

    // the local header repeats the name/extra lengths, and they can differ
    if (dv.getUint32(localOff, true) !== SIG_LOCAL) throw new Error('Corrupt ZIP entry: ' + name);
    const lNameLen  = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const dataAt    = localOff + 30 + lNameLen + lExtraLen;
    const raw       = buf.subarray(dataAt, dataAt + compSize);

    if (!name.endsWith('/')){
      out.set(name, method === 0 ? new Uint8Array(raw)
            : method === 8 ? await inflateRaw(raw)
            : (() => { throw new Error('Unsupported compression in ' + name); })());
    }
    off += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

/* ---------- write ---------- */
/**
 * @param {Array<{name:string, data:Uint8Array|string}>|Map} entries
 * @param {{compress?:boolean, mimeType?:string}} [opt]
 * @returns {Promise<Blob>}
 */
async function write(entries, opt){
  opt = opt || {};
  const compress = opt.compress !== false;
  const list = entries instanceof Map
    ? [...entries].map(([name, data]) => ({ name, data }))
    : entries;

  const enc = new TextEncoder();
  const parts = [], central = [];
  const now = new Date();
  const dosTime = (now.getHours()<<11) | (now.getMinutes()<<5) | (now.getSeconds()>>1);
  const dosDate = ((now.getFullYear()-1980)<<9) | ((now.getMonth()+1)<<5) | now.getDate();
  let offset = 0;

  for (const e of list){
    const nameBytes = enc.encode(e.name);
    const raw = typeof e.data === 'string' ? enc.encode(e.data)
              : e.data instanceof Uint8Array ? e.data : new Uint8Array(e.data);

    // only bother compressing when it actually helps
    let body = raw, method = 0;
    if (compress && raw.length > 128){
      const packed = await deflateRaw(raw);
      if (packed.length < raw.length){ body = packed; method = 8; }
    }
    const sum = crc32(raw);

    const lbuf = new ArrayBuffer(30 + nameBytes.length), lh = new DataView(lbuf);
    lh.setUint32(0, SIG_LOCAL, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0, true);
    lh.setUint16(8, method, true);
    lh.setUint16(10, dosTime, true);  lh.setUint16(12, dosDate, true);
    lh.setUint32(14, sum, true);
    lh.setUint32(18, body.length, true);
    lh.setUint32(22, raw.length, true);
    lh.setUint16(26, nameBytes.length, true);
    lh.setUint16(28, 0, true);
    new Uint8Array(lbuf).set(nameBytes, 30);
    parts.push(lbuf, body);

    const cbuf = new ArrayBuffer(46 + nameBytes.length), cd = new DataView(cbuf);
    cd.setUint32(0, SIG_CENTRAL, true);
    cd.setUint16(4, 20, true);        cd.setUint16(6, 20, true);
    cd.setUint16(8, 0, true);         cd.setUint16(10, method, true);
    cd.setUint16(12, dosTime, true);  cd.setUint16(14, dosDate, true);
    cd.setUint32(16, sum, true);
    cd.setUint32(20, body.length, true);
    cd.setUint32(24, raw.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint16(30, 0, true);        cd.setUint16(32, 0, true);
    cd.setUint16(34, 0, true);        cd.setUint16(36, 0, true);
    cd.setUint32(38, 0, true);        cd.setUint32(42, offset, true);
    new Uint8Array(cbuf).set(nameBytes, 46);
    central.push(cbuf);

    offset += 30 + nameBytes.length + body.length;
  }

  const cdSize = central.reduce((n,b) => n + b.byteLength, 0);
  const ebuf = new ArrayBuffer(22), eo = new DataView(ebuf);
  eo.setUint32(0, SIG_EOCD, true);
  eo.setUint16(8, list.length, true);
  eo.setUint16(10, list.length, true);
  eo.setUint32(12, cdSize, true);
  eo.setUint32(16, offset, true);
  return new Blob(parts.concat(central, [ebuf]), { type: opt.mimeType || 'application/zip' });
}

const API = { read, write, crc32, inflateRaw, deflateRaw };
if (typeof module === 'object' && module.exports) module.exports = API;
else root.Zip = API;

})(typeof self !== 'undefined' ? self : this);
