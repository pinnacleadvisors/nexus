// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { tracesSampler } from "@/lib/sentry/sampler";

Sentry.init({
  dsn: "https://8e6ee1e8d4203bc4f7feb2cc947c1f64@o4511206891126784.ingest.de.sentry.io/4511276744310864",

  // Per-transaction sampling — see lib/sentry/sampler.ts for the policy.
  // Polling endpoints → 0 (skip); high-value boundaries → 1; baseline 5%.
  // Replaces `tracesSampleRate: 1` which was burning 1M spans/day on
  // /api/platform-chat/poll + /api/gateway-status + /api/health/cron alone.
  tracesSampler,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,
});
