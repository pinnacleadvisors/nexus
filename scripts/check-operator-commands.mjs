#!/usr/bin/env node
// Mechanical guard: every operator-facing `npm run <x>` must be documented in
// docs/runbooks/operator-commands.md (the canonical reference operators copy-paste
// from). Enforces the AGENTS.md "Script ↔ docs sync" rule so a new/renamed operator
// command can't ship undocumented.
//
// Internal CI/build scripts are NOT operator-facing and are allowlisted by prefix.
// A `X:local` / `X:dry` variant counts as covered if its base `X` is documented.
//
// To exempt a genuinely-internal script, add its name (or prefix) to INTERNAL below
// with a one-line reason. To fix a real miss, document the command in operator-commands.md.
import fs from 'node:fs';

const DOC = 'docs/runbooks/operator-commands.md';
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const doc = fs.readFileSync(DOC, 'utf8');
const scripts = Object.keys(pkg.scripts || {});

// Internal (CI guards, build tooling, test runners, codegen) — documented in
// AGENTS.md's pre-commit checklist, not the operator runbook.
const INTERNAL = /^(dev|build|start|lint|prepare|postinstall|check:|test:|seed:|types:|sync:)/;

const missing = [];
for (const name of scripts) {
  if (INTERNAL.test(name)) continue;
  const base = name.replace(/:(local|dry)$/, ''); // variants ride on the base command's docs
  if (doc.includes(name) || (base !== name && doc.includes(base))) continue;
  missing.push(name);
}

if (missing.length) {
  console.error(`\n✘ ${DOC} is missing these operator-facing npm scripts:\n  - ${missing.join('\n  - ')}`);
  console.error(`\nFix: document each in ${DOC}, OR add it to the INTERNAL allowlist in`);
  console.error('     scripts/check-operator-commands.mjs with a one-line reason (if it is not operator-facing).');
  process.exit(1);
}

console.log(`✅  operator-commands.md covers all operator-facing npm scripts (${scripts.length} scripts scanned).`);
