#!/usr/bin/env node
// Mechanical guard: CLAUDE.md MUST begin with `@AGENTS.md`.
//
// Why this matters — the agnostic-wiring invariant:
//   AGENTS.md is the model-agnostic cross-agent standard (read natively by Codex,
//   Cursor, opencode, and any other agent). CLAUDE.md is the Claude adapter; its
//   first line `@AGENTS.md` imports the agnostic core so Claude Code instances
//   load the SAME rules every other agent reads. If that import line is ever
//   deleted, reordered, or typo'd, Claude silently stops reading the agnostic
//   rules and the platform's "any agent behaves consistently" guarantee breaks
//   with no visible error. This guard makes that failure loud at commit time.
//
// Fix if this fails: ensure the FIRST non-empty line of CLAUDE.md is exactly
//   `@AGENTS.md` (Claude Code's import directive — pulls AGENTS.md into context).
import fs from 'node:fs';

const FILE = 'CLAUDE.md';
const IMPORT = '@AGENTS.md';

if (!fs.existsSync(FILE)) {
  console.error(`\n✘ ${FILE} not found — the Claude adapter that imports the agnostic AGENTS.md core is missing.`);
  process.exit(1);
}

const raw = fs.readFileSync(FILE, 'utf8');
// First non-empty, non-whitespace line must be exactly the import directive.
const firstLine = raw.split('\n').map((l) => l.trim()).find((l) => l.length > 0);

if (firstLine !== IMPORT) {
  console.error(`\n✘ ${FILE} must start with \`${IMPORT}\` (got: ${JSON.stringify(firstLine ?? '<empty file>')}).`);
  console.error(`\nThe agnostic wiring is broken: Claude Code loads ${FILE} but without the`);
  console.error(`\`${IMPORT}\` import it no longer reads the model-agnostic AGENTS.md rules that`);
  console.error('every other agent (Codex, Cursor, opencode) reads natively.');
  console.error(`Fix: make the first non-empty line of ${FILE} exactly \`${IMPORT}\`.`);
  process.exit(1);
}

console.log(`✅  ${FILE} imports the agnostic core (\`${IMPORT}\` first line) — cross-agent wiring intact.`);
