// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { tracesSampler } from "@/lib/sentry/sampler";

Sentry.init({
  dsn: "https://8e6ee1e8d4203bc4f7feb2cc947c1f64@o4511206891126784.ingest.de.sentry.io/4511276744310864",

  // Add optional integrations for additional features
  integrations: [Sentry.replayIntegration()],

  // Per-transaction sampling — see lib/sentry/sampler.ts. Client-side
  // <GatewayStatusPill> and the Sidebar cron probe both poll every 30s on
  // every protected page; PlatformChat polls /api/platform-chat/poll every
  // 2.5s during an active run. Those generate XHR transactions that the
  // sampler now skips.
  tracesSampler,
  // Ship logs to Sentry only when an error is also being reported. The
  // unconditional `enableLogs: true` was contributing to the /monitoring 429s
  // (Sentry tunnel rate-limit) on top of the 2026-05-12 span-budget burn —
  // every console.* call shipped a log event regardless of severity. Keep
  // logs for the server/edge configs where volume is bounded; client volume
  // scales with every browser tab on every protected page.
  enableLogs: false,

  // Replay sampling — 10% session-rate generated enough payload to saturate
  // the ingest tunnel during peak usage. Errors still get a full replay via
  // replaysOnErrorSampleRate, which is the high-signal case.
  replaysSessionSampleRate: 0.01,

  // Define how likely Replay events are sampled when an error occurs.
  replaysOnErrorSampleRate: 1.0,

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
