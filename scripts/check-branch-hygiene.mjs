#!/usr/bin/env node
// Branch-hygiene guard — catches the two ways work gets silently lost on this
// multi-agent repo:
//
//   1. STRANDED COMMITS  — you have local commits on a branch whose PR already
//      MERGED. Their content is in no merged PR; the next `main` sync makes them
//      invisible. This is exactly the 2026-06-04 incident (the check:operator-
//      commands guard was stranded on chore/deploy-script-mac-primary after #474
//      merged). Recovery: branch off latest main + cherry-pick the stranded SHAs.
//
//   2. STALE BRANCH      — your branch is far behind origin/main, so a PR off it
//      is a conflict trap. Rebase (or reset+cherry-pick for stacked branches)
//      before opening the PR.
//
// Run before pushing / opening a PR, and as the last action of a session.
// Fail-soft: if `gh` or the network is unavailable it degrades to git-only
// checks and never blocks on infrastructure it can't reach.
//
// Usage:  npm run check:branch-hygiene
import { execSync } from 'node:child_process';

const sh = (cmd, opts = {}) => {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...opts }).trim(); }
  catch { return null; }
};

const branch = sh('git rev-parse --abbrev-ref HEAD');
if (!branch) { console.error('✘ not in a git repo'); process.exit(1); }

if (branch === 'main' || branch === 'HEAD') {
  console.log(`✅  on ${branch} — nothing to check.`);
  process.exit(0);
}

// Make sure our view of main is fresh (best-effort; offline is fine).
sh('git fetch origin main --quiet');

const ahead = sh('git rev-list --count origin/main..HEAD') ?? '0';
const behind = sh('git rev-list --count HEAD..origin/main') ?? '0';
const aheadN = Number(ahead);
const behindN = Number(behind);

// Is this branch's PR already merged? (best-effort via gh)
let prState = null;
const ghJson = sh(`gh pr view ${branch} --json state,number,mergedAt 2>/dev/null`);
if (ghJson) { try { prState = JSON.parse(ghJson); } catch { /* ignore */ } }

const problems = [];
const warnings = [];

// 1. STRANDED: PR merged but local commits not in main.
if (prState?.state === 'MERGED' && aheadN > 0) {
  const shas = sh('git log --oneline origin/main..HEAD') ?? '';
  problems.push(
    `STRANDED COMMITS — PR #${prState.number} for "${branch}" is MERGED, but ${aheadN} commit(s) here are not in origin/main:\n` +
    shas.split('\n').map((l) => `      ${l}`).join('\n') +
    `\n    These are orphaned. Recover them:\n` +
    `      git checkout main && git pull --ff-only\n` +
    `      git checkout -b <fresh-branch>\n` +
    `      git cherry-pick ${shas.split('\n').map((l) => l.split(' ')[0]).join(' ')}\n` +
    `      # then open a NEW PR (the merged branch is dead — never push to it again)`
  );
}

// 2. STALE: branch is far behind main (conflict trap).
if (behindN >= 50) {
  warnings.push(`STALE — "${branch}" is ${behindN} commits behind origin/main. Rebase (or reset+cherry-pick for stacked branches) before opening the PR.`);
}

if (warnings.length) {
  for (const w of warnings) console.warn(`⚠  ${w}`);
}

if (problems.length) {
  console.error('\n✘ branch-hygiene check failed:\n');
  for (const p of problems) console.error(`  - ${p}\n`);
  console.error('See CLAUDE.md → "After PR merge — the branch is terminated" + AGENTS.md → "Branch hygiene".');
  process.exit(1);
}

const note = prState ? `PR #${prState.number} ${prState.state}` : 'no PR yet';
console.log(`✅  "${branch}" clean — ${aheadN} ahead / ${behindN} behind origin/main (${note}).`);
