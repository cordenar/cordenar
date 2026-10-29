#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));

const USAGE = `Cordenar — the shared brain for teams of humans and AI

Usage:
  cordenar                 Run the MCP server (launched by your AI harness)
  cordenar dashboard       Start the dashboard and open it in your browser

Options:
  -h, --help               Show this help message
  -v, --version            Print the version`;

const cmd = process.argv[2];

if (cmd === '-h' || cmd === '--help') {
  console.log(USAGE);
  process.exit(0);
}

if (cmd === '-v' || cmd === '--version') {
  console.log(pkg.version);
  process.exit(0);
}

if (cmd === 'dashboard') {
  const child = spawn(process.execPath, [join(__dirname, 'dashboard.js'), '--open'], { stdio: 'inherit' });
  child.on('error', (err) => {
    console.error('cordenar: ' + err.message);
    process.exit(1);
  });
  child.on('exit', (code) => process.exit(code == null ? 0 : code));
} else if (cmd === undefined) {
  await import('./index.js');
} else {
  console.error('cordenar: unknown command: ' + cmd);
  console.error(USAGE);
  process.exit(2);
}
