-- Migration: 008_critical_rls_fixes.sql
-- Description: Enable RLS on oauth_tokens and app_state tables
-- Date: 2026-01-18
-- Security: CRITICAL

-- Enable RLS on oauth_tokens (contains encrypted OAuth credentials)
ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;

-- Deny all access to oauth_tokens from authenticated/public roles
-- Service role bypasses RLS and retains full access
CREATE POLICY "Deny all direct access to oauth_tokens"
  ON oauth_tokens
  FOR ALL
  TO public, authenticated
  USING (false)
  WITH CHECK (false);

-- Enable RLS on app_state (contains runtime state)
ALTER TABLE app_state ENABLE ROW LEVEL SECURITY;

-- Deny all access to app_state from authenticated/public roles
CREATE POLICY "Deny all direct access to app_state"
  ON app_state
  FOR ALL
  TO public, authenticated
  USING (false)
  WITH CHECK (false);

-- Add missing INSERT policies for service role (documentation)
CREATE POLICY "Service role can insert jobs"
  ON jobs
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can insert estimates"
  ON estimates
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update estimates"
  ON estimates
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can manage pricing_history"
  ON pricing_history
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Comments for future developers
COMMENT ON TABLE oauth_tokens IS
  'Contains encrypted OAuth tokens for Gmail and QuickBooks.
   RLS is enabled with deny-all policies to prevent accidental exposure
   if authenticated access is added in the future.
   Service role bypasses RLS and has full access.';

COMMENT ON TABLE app_state IS
  'Contains runtime application state (e.g., Gmail watch historyId).
   RLS is enabled with deny-all policies for future safety.
   Service role bypasses RLS and has full access.';
