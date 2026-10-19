#!/usr/bin/env node
/**
 * Creates the oversized sample files used by "file too large" tests. They are too big to keep
 * in git, so each machine makes its own (QA Runner.bat runs this on first start).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const dir = config.data.filesDir;
fs.mkdirSync(dir, { recursive: true });
const MB = 1024 * 1024;

function padded(src, name, size) {
  const out = path.join(dir, name);
  if (fs.existsSync(out) && fs.statSync(out).size >= size) return;
  // Valid file first, random bytes after: still opens, but is over the size limit.
  const head = fs.readFileSync(path.join(dir, src));
  fs.writeFileSync(out, Buffer.concat([head, crypto.randomBytes(size - head.length)]));
  console.log('made', name);
}

padded('valid-document.pdf', 'too-large-3MB.pdf', 3 * MB + 100000);
padded('valid-document.pdf', 'too-large-9MB.pdf', 9 * MB + 100000);
padded('signature.png', 'signature-too-large-8MB.png', 8 * MB + 100000);

const csv = path.join(dir, 'sss-too-large-11MB.csv');
if (!fs.existsSync(csv) || fs.statSync(csv).size < 11 * MB) {
  const lines = ['compFrom,compTo,monthly_reg_ss_ec,monthly_mpf,employer_reg_ss,employer_mpf,employer_ec,employee_reg_ss,employee_mpf'];
  let size = lines[0].length, from = 1000;
  while (size < 11 * MB) { const l = `${from},${(from + 0.99).toFixed(2)},4000,0,380,0,10,180,0`; lines.push(l); size += l.length + 1; from++; }
  fs.writeFileSync(csv, lines.join('\n'));
  console.log('made sss-too-large-11MB.csv');
}
console.log('Test files ready in', dir);
