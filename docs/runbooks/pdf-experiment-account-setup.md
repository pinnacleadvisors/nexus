# PDF Experiment — account setup guide

What to create, in what order, and how to name it. The agents pick the niche via the first `niche_pick` gate; everything else (brand, handles, domain) flows from that one decision. This guide covers the **operator-side** setup the agents can't do themselves.

## Naming convention — pick a brand once, reuse everywhere

Once the niche-pick gate fires in Slack, derive a 4-10 character brand from the approved niche. The brand becomes the slug across every account so password recovery, audit logs, and screenshots are readable.

| Niche example | Brand | Domain | Email | X | LinkedIn |
|---|---|---|---|---|---|
| Tax organizers for solo accountants | `LedgerLane` | `ledgerlane.co` | `hello@ledgerlane.co` | `@ledgerlane` | `ledger-lane` |
| Notion templates for product managers | `PMStack` | `pmstack.co` | `hello@pmstack.co` | `@pmstackhq` | `pmstack` |
| Real-estate investment underwriting PDFs | `DealPad` | `dealpad.co` | `hello@dealpad.co` | `@dealpadhq` | `dealpad` |
| Freelance contract bundles | `Inkbound` | `inkbound.co` | `hello@inkbound.co` | `@inkbound` | `inkbound` |

**Rules of thumb:**
- 1-2 syllable brand, no hyphens, easy to spell over the phone
- `.co` is the default — `.com` if available + the brand is short enough that the registration cost is < $25
- If the X/Instagram handle is taken, append `hq` or `app` (e.g. `@pmstackhq`) — never numerals like `pmstack2`
- LinkedIn page slug uses kebab-case (it's the URL form); X handle stays bare
- Use one Gmail (or Google Workspace seat) per business — it's the **password-recovery hub** for every other account below

---

## Order of operations

Do these once per business, in this order. The agents pick up from step 7.

### 1. Gmail — `<brand>@gmail.com` (or Workspace `hello@<brand>.co` once domain is up)
Single email = single source of truth for password recovery. Two options:
- **Free**: `<brand>businesshq@gmail.com` — fastest to provision, fine for the experiment
- **Paid (recommended once revenue lands)**: Google Workspace seat for `hello@<brand>.co`, ~$6/mo. Migrate the consumer Gmail's app signups to the Workspace mailbox via "send-mail-as" forwarding.

Enable 2FA. Generate an app password if any tool needs SMTP.

### 2. Domain — `<brand>.co`
Buy at Namecheap (default) or Cloudflare Registrar (cheaper renewals, but no transfer-to-Cloudflare-DNS friction). For the experiment: stick with Namecheap for the purchase, then **delegate DNS to Cloudflare** per `docs/runbooks/namecheap-to-cloudflare-dns.md` so the agent can manage records via the Cloudflare API.

Cost: ~$12/yr.

### 3. Cloudflare account + zone
- Sign up at https://dash.cloudflare.com/sign-up using the Gmail from step 1
- Add the `<brand>.co` zone, follow the Namecheap-DNS-delegation runbook
- Create a zone-scoped API token (My Profile → API Tokens → "Edit zone DNS" template, restricted to this single zone)
- Paste the token at `/settings/accounts?businessSlug=pdf-experiment-01` under Cloudflare DNS (apiKeySetup form)

Cost: $0 (free tier covers many zones).

### 4. Vercel team for the storefront
Use the Gmail from step 1 to sign up. Add the `<brand>.co` domain to the project once the agent ships v1 of the storefront. The agent uses the Vercel toolkit via Composio — connect at `/settings/accounts?businessSlug=pdf-experiment-01` after the OAuth round-trip.

Cost: $0 (Hobby tier covers a starter storefront; upgrade only if you need team features).

### 5. Stripe — payments
- Sign up with the Gmail from step 1 + the `<brand>.co` business name
- Activate the account (requires real legal entity info — your existing LLC works, or use a sole-proprietor structure if you don't have an LLC yet)
- Enable Stripe Checkout (default; the storefront uses hosted checkout for v1)
- Connect at `/settings/accounts?businessSlug=pdf-experiment-01` (Composio Stripe toolkit)

Cost: 2.9% + $0.30 per transaction. No monthly fee.

### 6. ConvertKit (Kit) — email list
- Sign up with the Gmail from step 1
- Free tier: up to 10k subscribers. Plenty of headroom for the experiment.
- Generate a V4 API key: Settings → Advanced → API & Webhooks → V4 API Keys → Create new key
- Paste at `/settings/accounts?businessSlug=pdf-experiment-01` under ConvertKit (apiKeySetup form)

Cost: $0 free tier; $42/mo Launch tier when you cross 10k subs OR want automation features (revisit at validation).

### 7. Social handles — claim the brand
Even if the agent won't post on day 1, **claim the handles** so squatters don't take them. 5-min job per platform.

| Platform | Handle | Bio template | Profile photo | Notes |
|---|---|---|---|---|
| X (Twitter) | `@<brand>` (or `@<brand>hq` if taken) | "Practical PDFs for [audience] · Made with [stack notes if dev-y, else skip] · DM open" | Brand wordmark on white square | Connect via Composio at `/settings/accounts?businessSlug=pdf-experiment-01` after the OAuth round-trip. Twitter requires you provide your own dev app credentials per `docs/runbooks/solopreneur-experiment.md` Slack-app-config section. |
| LinkedIn | Company page `linkedin.com/company/<brand>` | Same bio + the niche keyword | Same wordmark | Composio toolkit ships with managed creds. |
| Instagram | `@<brand>` | Same bio | Same wordmark | Optional for v1. Skip if agent doesn't include it in the niche-pick rationale. |
| YouTube | Channel name = brand | "Tutorials and tools for [audience]" | Same wordmark | Optional for v1. |

**Bio anti-patterns**: don't start with "AI-powered" / "the future of" — the agent may write copy that drifts there; trim it on review.

---

## What the agents do for you (no operator setup needed)
- GitHub repo for the storefront source (Composio GitHub toolkit)
- Notion workspace if the niche calls for it (Composio Notion toolkit)
- Google Docs for collateral drafts (Composio Google Docs toolkit)
- Discord / Slack for community (when revenue justifies opening one)

---

## Final checklist before approving the niche-pick gate

- [ ] Gmail created, 2FA on, app password ready if needed
- [ ] Domain purchased, DNS delegated to Cloudflare
- [ ] Cloudflare zone-scoped token pasted into `/settings/accounts?businessSlug=pdf-experiment-01`
- [ ] Vercel team ready (account level — the agent will create the project)
- [ ] Stripe account activated, Checkout enabled
- [ ] ConvertKit V4 API key pasted into `/settings/accounts?businessSlug=pdf-experiment-01`
- [ ] X / LinkedIn handles claimed, both connected via Composio in `/settings/accounts`
- [ ] All passwords stored in your password manager under one folder named `<brand>` for easy revocation later

Once this is green, click **Approve** on the niche-pick Slack message and the agent takes it from there.

---

## Cross-links
- Solopreneur experiment overview: [`solopreneur-experiment.md`](./solopreneur-experiment.md)
- DNS delegation steps: [`namecheap-to-cloudflare-dns.md`](./namecheap-to-cloudflare-dns.md)
- Codex auth rotation cadence: [`codex-gateway-auth-rotation.md`](./codex-gateway-auth-rotation.md)
- Per-business container provisioning: [`per-business-container-rollout.md`](./per-business-container-rollout.md)
