/**
 * middleware.ts — Next.js requires this exact filename for middleware.
 * Auth logic lives in proxy.ts (project convention — do not rename proxy.ts).
 * This file simply re-exports from proxy.ts so Next.js picks it up.
 */
export { default, config } from './proxy'
