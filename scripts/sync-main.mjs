#!/usr/bin/env node
// sync-main.mjs — the ONE safe command to run after a PR merges.
//
// Prevents the recurring `git pull` trap on this repo. Because the repo has
// `deleteBranchOnMerge: true`, the moment your PR merges the REMOTE branch is
// deleted. If you're still sitting on the local feature branch and run a bare
// `git pull`, git tries to fetch that branch's now-gone upstream ref and dies:
//
//     Your configuration specifies to merge with the ref
//     'refs/heads/<branch>' from the remote, but no such ref was fetched.
//
// The correct post-merge move is always: get back onto a fresh main and bin the
// dead local branch. This script does exactly that, safely:
//
//   1. Ensures `fetch.prune=true` (so deleted remote branches stop lingering as
//      stale origin/<branch> refs — the root of the confusion).
//   2. `git fetch origin --prune`.
//   3. Fast-forwards local main to origin/main.
//   4. If you ran it FROM a dead branch (PR merged / upstream gone), moves you to
//      main first.
//   5. Deletes every local branch whose upstream is gone (= its PR merged and the
//      remote branch was auto-deleted). Never touches the branch you're on or a
//      branch with a live upstream.
//
// Non-destructive to live work: a feature branch with an intact upstream is left
// alone (you just get an ahead/behind report). Aborts before switching branches
// if the working tree is dirty.
//
// Usage:  npm run sync
import { execSync } from 'node:child_process';

const sh = (cmd, { fatal = false } = {}) => {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch (e) { if (fatal) { console.error(`✘ failed: ${cmd}`); process.exit(1); } return null; }
};

const inRepo = sh('git rev-parse --is-inside-work-tree');
if (!inRepo) { console.error('✘ not in a git repo'); process.exit(1); }

// 1. Make stale-ref pruning the default for this clone (idempotent).
if (sh('git config --get fetch.prune') !== 'true') {
  sh('git config fetch.prune true');
  console.log('• set fetch.prune=true for this clone (deleted remote branches now auto-prune).');
}

const startBranch = sh('git rev-parse --abbrev-ref HEAD');
const dirty = Boolean(sh('git status --porcelain'));

// 2. Fetch + prune.
console.log('→ git fetch origin --prune …');
sh('git fetch origin --prune', { fatal: true });

// Helper: is a branch's upstream gone? (remote deleted = its PR merged)
const upstreamGone = (b) =>
  sh(`git rev-parse --abbrev-ref --symbolic-full-name ${b}@{upstream}`) === null &&
  // distinguish "had an upstream that's now gone" from "never had one"
  Boolean(sh(`git config --get branch.${b}.merge`));

// 3/4. Get onto a fresh main.
const currentDead = startBranch !== 'main' && upstreamGone(startBranch);
if (startBranch !== 'main') {
  if (dirty) {
    console.error(`\n✘ working tree is dirty on "${startBranch}" — commit or stash before syncing (won't switch branches over uncommitted work).`);
    process.exit(1);
  }
  if (currentDead) {
    console.log(`• "${startBranch}" is merged (its remote branch was deleted) — switching to main.`);
  } else {
    console.log(`• "${startBranch}" still has a live upstream — leaving it checked out after the sync.`);
  }
  sh('git checkout main', { fatal: true });
}

const ff = sh('git merge --ff-only origin/main');
if (ff === null) {
  console.error('\n✘ local main could not fast-forward to origin/main (it has diverging local commits). Resolve manually.');
  process.exit(1);
}
console.log(`✓ main at ${sh('git log --oneline -1')}`);

// 5. Delete every merged (upstream-gone) local branch.
const locals = (sh('git for-each-ref --format=%(refname:short) refs/heads/') ?? '')
  .split('\n').filter(Boolean).filter((b) => b !== 'main' && b !== startBranch);
const dead = locals.filter(upstreamGone);
const deletedNow = [];
if (currentDead) {
  // startBranch was the one we just left — safe to delete now.
  if (sh(`git branch -D ${startBranch}`) !== null) deletedNow.push(startBranch);
}
for (const b of dead) {
  if (sh(`git branch -D ${b}`) !== null) deletedNow.push(b);
}
if (deletedNow.length) {
  console.log(`✓ deleted ${deletedNow.length} merged local branch(es): ${deletedNow.join(', ')}`);
} else {
  console.log('• no merged local branches to delete.');
}

// Report any branches kept (live upstream) so nothing is a surprise.
const kept = locals.filter((b) => !dead.includes(b));
const keptCurrent = !currentDead && startBranch !== 'main' ? [startBranch] : [];
const allKept = [...keptCurrent, ...kept];
if (allKept.length) {
  console.log(`• kept (live upstream): ${allKept.join(', ')}`);
}

const nowOn = sh('git rev-parse --abbrev-ref HEAD');
console.log(`\n✅  synced. You're on "${nowOn}". Start new work with: git checkout -b <branch> origin/main`);
