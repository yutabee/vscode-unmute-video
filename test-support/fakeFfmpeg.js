'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// A fake ffmpeg: writes a minimal MP3 to its last arg, optionally emits N MB of
// stderr, optionally delays, and appends one byte to a counter file per call.
const EXTRACT_FAKE_SRC = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const out = args[args.length - 1];
const counter = process.env.UNMUTE_FAKE_COUNTER;
if (counter) { try { fs.appendFileSync(counter, 'x'); } catch {} }
const mb = parseInt(process.env.UNMUTE_FAKE_STDERR_MB || '0', 10);
if (mb > 0) {
  const chunk = 'E'.repeat(64 * 1024);
  for (let i = 0; i < mb * 16; i++) process.stderr.write(chunk);
}
const delay = parseInt(process.env.UNMUTE_FAKE_DELAY_MS || '0', 10);
setTimeout(() => {
  // "ID3" tag header so it reads as an MP3.
  fs.writeFileSync(out, Buffer.from([0x49, 0x44, 0x33, 0x03, 0, 0, 0, 0, 0, 0]));
  process.exit(0);
}, delay);
`;

function writeExtractFake(dir) {
  const bin = path.join(dir, 'fake-ffmpeg.js');
  fs.writeFileSync(bin, EXTRACT_FAKE_SRC, { mode: 0o755 });
  return bin;
}

// A fake ffmpeg: a node shebang script that records each `-version` probe by
// appending a byte to a counter file, then exits with the given code (0 =
// "this binary works", non-zero = "probe fails"). Unix-only (shebang +x).
function makeProbeFake(dir, name, exitCode) {
  const counter = path.join(dir, `${name}.count`);
  const bin = path.join(dir, name);
  const script =
    '#!/usr/bin/env node\n' +
    `require('fs').appendFileSync(${JSON.stringify(counter)}, 'x');\n` +
    `process.exit(${exitCode});\n`;
  fs.writeFileSync(bin, script, { mode: 0o755 });
  return {
    bin,
    probeCount: () => (fs.existsSync(counter) ? fs.readFileSync(counter, 'utf8').length : 0),
  };
}

function uniqueInput(dir) {
  // Unique content => unique (size+mtime+path) cache key => no cross-test cache hit.
  const p = path.join(dir, `in-${crypto.randomBytes(6).toString('hex')}.mp4`);
  fs.writeFileSync(p, crypto.randomBytes(64));
  return p;
}

module.exports = {
  writeExtractFake,
  makeProbeFake,
  uniqueInput,
};
