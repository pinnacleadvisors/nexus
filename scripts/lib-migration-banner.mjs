/**
 * Shared "doc propagation" banner for migration scripts.
 *
 * Recommendation F from the agent-process audit. After any migration
 * applies, this banner reminds the operator to propagate the change
 * through the docs — single biggest source of KVM2-style drift was
 * that the migration shipped successfully and the docs never followed.
 *
 * Usage (in any `scripts/migrate-*.mjs --apply` path):
 *
 *   import { printDocPropagationBanner } from './lib-migration-banner.mjs'
 *   // ... migration completes ...
 *   printDocPropagationBanner({ scriptName: 'migrate-foo' })
 *
 * Soft nudge — easy to ignore, cheap to add. The mechanical force is
 * `npm run check:topology` and `npm run check:agent-spec-freshness`;
 * this banner is the moment-of-action reminder.
 */

function color(code, s) { return process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s }
const cyan   = s => color('36', s)
const yellow = s => color('33', s)
const dim    = s => color('2',  s)
const bold   = s => color('1',  s)

/**
 * Print the doc-propagation banner to stdout.
 *
 * @param {object} [opts]
 * @param {string} [opts.scriptName] — script name (without .mjs) for the
 *   intro line. Helpful when the operator pipes output and only sees the
 *   banner detached from the surrounding context.
 * @param {string[]} [opts.extras] — extra reminders specific to this
 *   migration, appended as additional bullets after the standard list.
 */
export function printDocPropagationBanner({ scriptName, extras = [] } = {}) {
  const tag = scriptName ? ` (${scriptName})` : ''
  console.log()
  console.log(cyan(bold(`📋  Migration applied${tag}. Before opening your PR — propagate the change through the docs:`)))
  console.log()
  console.log(yellow('   1.') + ` Update ${bold('AGENTS.md → Topology')} section if hosts / services / managed resources changed.`)
  console.log(yellow('   2.') + ` Update ${bold('memory/platform/SECRETS.md')} if env vars were added / removed / renamed.`)
  console.log(yellow('   3.') + ` Bump ${bold('topology_last_verified')} on touched ${bold('.claude/agents/*.md')} specs.`)
  console.log(yellow('   4.') + ` Write a ${bold('memory-hq atom')} per ${bold('AGENTS.md → Post-infrastructure-change memory protocol')} —`)
  console.log(`       so future agent sessions discover the new topology via ${bold('memory_search')}.`)
  console.log(yellow('   5.') + ` Run ${bold('npm run check:all')} — verifies topology, agent-spec freshness, retry-storm, sentry, lockfile.`)
  for (const extra of extras) {
    console.log(yellow('   •') + ` ${extra}`)
  }
  console.log()
  console.log(dim('   This banner is a soft reminder — mechanical enforcement is via npm run check:topology + check:agent-spec-freshness.'))
  console.log()
}
