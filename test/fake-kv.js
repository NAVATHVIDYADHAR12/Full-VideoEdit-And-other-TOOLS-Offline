/* A minimal in-memory stand-in for Upstash's REST API, for local testing. */
const http = require('http');
const DB = new Map();

http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => raw += c);
  req.on('end', () => {
    let result = null;
    try {
      const args = JSON.parse(raw);
      const op = String(args[0]).toUpperCase(), key = args[1];
      if (op === 'GET')         result = DB.has(key) ? DB.get(key) : null;
      else if (op === 'SET'){
        if (args.includes('NX') && DB.has(key)) result = null;
        else { DB.set(key, args[2]); result = 'OK'; }
      }
      else if (op === 'DEL')    result = DB.delete(key) ? 1 : 0;
      else if (op === 'INCR'){  DB.set(key, String(Number(DB.get(key) || 0) + 1));
                                result = Number(DB.get(key)); }
      else if (op === 'EXPIRE') result = 1;
    } catch (e) { /* fall through as null */ }
    res.writeHead(200, { 'Content-Type':'application/json' });
    res.end(JSON.stringify({ result }));
  });
}).listen(8199, () => console.log('fake kv on 8199'));
