-- Migration: 004_rls_policies
-- Description: Row-level security policies for multi-tenant data isolation
-- Applied by: npm run migrate
--
-- ⚠️  RLS relies on Clerk JWT → Supabase JWT integration.
--     Until that is configured, the server-side service role key bypasses all
--     policies automatically — nothing will break for single-user deployments.
--
-- To activate user-level isolation:
--   1. In Clerk Dashboard → JWT Templates → create "supabase" template
--      Audience: https://<your-supabase-project>.supabase.co
--      Include claim: { "sub": "{{user.id}}" }
--   2. In Supabase Dashboard → Settings → API → JWT Secret → copy the secret
--   3. Paste it into the Clerk JWT template "Signing key" field
--   4. In your server code use the Clerk session token as the Supabase auth token
--      supabase.auth.setSession({ access_token: clerkToken, refresh_token: '' })

-- ── Enable RLS on all user-owned tables ──────────────────────────────────────
ALTER TABLE businesses       ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects         ENABLE ROW LEVEL SECURITY;
ALTER TABLE milestones       ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents           ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_events     ENABLE ROW LEVEL SECURITY;

-- ── Businesses — strictly per-user ───────────────────────────────────────────
DROP POLICY IF EXISTS "businesses_select_own" ON businesses;
DROP POLICY IF EXISTS "businesses_insert_own" ON businesses;
DROP POLICY IF EXISTS "businesses_update_own" ON businesses;
DROP POLICY IF EXISTS "businesses_delete_own" ON businesses;

CREATE POLICY "businesses_select_own" ON businesses
  FOR SELECT USING (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "businesses_insert_own" ON businesses
  FOR INSERT WITH CHECK (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "businesses_update_own" ON businesses
  FOR UPDATE USING (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "businesses_delete_own" ON businesses
  FOR DELETE USING (user_id = (auth.jwt() ->> 'sub'));

-- ── Projects — per-user (or legacy rows without user_id) ─────────────────────
DROP POLICY IF EXISTS "projects_select_own" ON projects;
DROP POLICY IF EXISTS "projects_insert_own" ON projects;
DROP POLICY IF EXISTS "projects_update_own" ON projects;
DROP POLICY IF EXISTS "projects_delete_own" ON projects;

CREATE POLICY "projects_select_own" ON projects
  FOR SELECT USING (user_id IS NULL OR user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "projects_insert_own" ON projects
  FOR INSERT WITH CHECK (true);

CREATE POLICY "projects_update_own" ON projects
  FOR UPDATE USING (user_id IS NULL OR user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "projects_delete_own" ON projects
  FOR DELETE USING (user_id IS NULL OR user_id = (auth.jwt() ->> 'sub'));

-- ── Tasks — open (linked to projects; inherit isolation via application logic) ─
DROP POLICY IF EXISTS "tasks_all" ON tasks;
CREATE POLICY "tasks_all" ON tasks FOR ALL USING (true) WITH CHECK (true);

-- ── Milestones — open ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "milestones_all" ON milestones;
CREATE POLICY "milestones_all" ON milestones FOR ALL USING (true) WITH CHECK (true);

-- ── Agents — open (shared infrastructure) ────────────────────────────────────
DROP POLICY IF EXISTS "agents_all" ON agents;
CREATE POLICY "agents_all" ON agents FOR ALL USING (true) WITH CHECK (true);

-- ── Alert thresholds — open ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "alert_thresholds_all" ON alert_thresholds;
CREATE POLICY "alert_thresholds_all" ON alert_thresholds FOR ALL USING (true) WITH CHECK (true);

-- ── Revenue events — open ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "revenue_events_all" ON revenue_events;
CREATE POLICY "revenue_events_all" ON revenue_events FOR ALL USING (true) WITH CHECK (true);

-- ── Token events — open ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "token_events_all" ON token_events;
CREATE POLICY "token_events_all" ON token_events FOR ALL USING (true) WITH CHECK (true);
