// Generate a supercronic crontab from crons.json — the LOCAL cron control
// surface for the Mac-mini host. Edit crons.json (enable/disable/reschedule),
// then `docker compose -f services/local-os/docker-compose.yaml restart cron-runner`.
//
// Each enabled job fires its route on the INTERNAL app URL (no tunnel hop) with
// the CRON_SECRET bearer, expanded by the shell at run time (never baked into
// the crontab). Output goes to stdout so `docker logs cron-runner` shows every
// hit — the agent-facing monitor surface.
import { readFileSync } from 'node:fs';

const TARGET = process.env.CRON_TARGET || 'http://nexus-app:3000';
const cfgPath = process.env.CRONS_JSON || '/app/cron/crons.json';

const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const jobs = (cfg.jobs || []).filter((j) => j.enabled && j.schedule);

const lines = [
  '# Auto-generated from crons.json by gen-crontab.mjs — DO NOT edit here.',
  '# Edit services/local-os/cron/crons.json then: compose restart cron-runner',
  '',
];

for (const { path, schedule, target } of jobs) {
  const base = target || TARGET;
  const cmd =
    'curl -fsS -m 120 -o /dev/null ' +
    '-w "' + path + ' -> HTTP %{http_code} (%{time_total}s)\\n" ' +
    '-H "Authorization: Bearer $CRON_SECRET" ' +
    '"' + base + path + '" || echo "' + path + ' -> CURL_FAIL"';
  lines.push(schedule + ' ' + cmd);
}

process.stderr.write(`[gen-crontab] ${jobs.length} enabled of ${(cfg.jobs || []).length} jobs\n`);
process.stdout.write(lines.join('\n') + '\n');
