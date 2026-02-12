#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const targetFile =
  process.argv[2] ??
  path.resolve(process.cwd(), 'target', 'train-Train.json');

const raw = fs.readFileSync(targetFile, 'utf8');
const artifact = JSON.parse(raw);

if (!Array.isArray(artifact.functions)) {
  throw new Error(`Invalid artifact format: missing functions[] in ${targetFile}`);
}

let changed = 0;
for (const fn of artifact.functions) {
  if (typeof fn?.name === 'string' && fn.name.startsWith('__aztec_nr_internals__')) {
    fn.name = fn.name.replace('__aztec_nr_internals__', '');
    changed++;
  }
}

fs.writeFileSync(targetFile, JSON.stringify(artifact));
console.log(`Updated ${changed} function names in ${targetFile}`);
