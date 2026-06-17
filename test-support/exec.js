'use strict';

const { execFile } = require('node:child_process');

function execFileAsync(bin, args, opts = { timeout: 60000 }) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, opts, (err, _stdout, stderr) =>
      err ? reject(new Error(stderr || err.message)) : resolve(),
    );
  });
}

module.exports = {
  execFileAsync,
};
