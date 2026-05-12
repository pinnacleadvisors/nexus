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
  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Define how likely Replay events are sampled.
  // This sets the sample rate to be 10%. You may want this to be 100% while
  // in development and sample at a lower rate in production
  replaysSessionSampleRate: 0.1,

  // Define how likely Replay events are sampled when an error occurs.
  replaysOnErrorSampleRate: 1.0,

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
