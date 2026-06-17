'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix + '-'));
}

function createCleanup() {
  const paths = [];
  return {
    track(p) {
      if (p) {
        paths.push(p);
      }
      return p;
    },
    run() {
      for (let i = paths.length - 1; i >= 0; i--) {
        const p = paths[i];
        try { fs.unlinkSync(p); } catch { /* ignore */ }
        try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
      }
      paths.length = 0;
    },
  };
}

module.exports = {
  makeTempDir,
  createCleanup,
};
