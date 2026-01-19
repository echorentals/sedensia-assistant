# RLS Quick Reference Card

## Current Architecture

```
Backend Only (Node.js/Fastify)
        ↓
Service Role Key (bypasses RLS)
        ↓
    Supabase DB
```

**Status:** ✅ Safe for current use
**Warning:** ⚠️ RLS policies not enforced

---

## Service Role vs Anon Key

### Service Role Key (Current)
```typescript
// src/db/client.ts
const supabase = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY  // ⚠️ Bypasses ALL RLS
);
```

**Use When:**
- ✅ Backend/server-side operations
- ✅ Admin/system tasks
- ✅ Batch jobs
- ✅ Migrations

**NEVER Use When:**
- ❌ Client-side JavaScript
- ❌ Mobile apps
- ❌ Browser applications
- ❌ Untrusted clients

### Anon Key (Not Currently Used)
```typescript
const supabase = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_ANON_KEY  // ✅ Enforces RLS
);
```

**Use When:**
- Client-side access needed
- User authentication required
- Multi-tenant applications

---

## RLS Status by Table

| Table | RLS Enabled | Policies | Status |
|-------|-------------|----------|--------|
| `oauth_tokens` | ❌ → ✅ (after fix) | Deny all | CRITICAL |
| `app_state` | ❌ → ✅ (after fix) | Deny all | CRITICAL |
| `contacts` | ✅ | Partial | OK |
| `estimates` | ✅ | Partial | OK |
| `jobs` | ✅ | Partial | OK |
| `sign_types` | ✅ | Read-only | OK |
| `materials` | ✅ | Read-only | OK |
| `pricing_history` | ✅ | Read-only | OK |
| `telegram_users` | ✅ | Service role only | ✅ GOOD |

---

## Quick Commands

### Check RLS Status
```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

### View Policies
```sql
SELECT schemaname, tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

### Test RLS (If Anon Key Available)
```typescript
const testClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_ANON_KEY
);

// Should fail with 42501 error
const { data, error } = await testClient
  .from('oauth_tokens')
  .select('*');
```

---

## Common RLS Patterns

### Deny All (High Security)
```sql
CREATE POLICY "deny_all"
  ON sensitive_table
  FOR ALL
  TO public, authenticated
  USING (false)
  WITH CHECK (false);
```

### Service Role Only
```sql
CREATE POLICY "service_role_only"
  ON admin_table
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
```

### Authenticated Read-Only
```sql
CREATE POLICY "authenticated_read"
  ON public_data
  FOR SELECT
  TO authenticated
  USING (true);
```

### User-Owned Data
```sql
CREATE POLICY "users_own_data"
  ON user_data
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

---

## Security Checklist

### Before Adding Client Access
- [ ] Enable RLS on ALL tables
- [ ] Create specific policies (not `USING (true)`)
- [ ] Test with `SUPABASE_ANON_KEY`
- [ ] Enable Supabase Auth
- [ ] Document access patterns
- [ ] Review security audit

### After RLS Changes
- [ ] Test with service role (should work)
- [ ] Test with anon key (should respect RLS)
- [ ] Test with authenticated user
- [ ] Check application logs
- [ ] Verify no regressions

---

## Emergency Rollback

If RLS causes issues:
```sql
-- Disable RLS (temporary)
ALTER TABLE problematic_table DISABLE ROW LEVEL SECURITY;

-- Remove policy
DROP POLICY "policy_name" ON problematic_table;

-- Re-enable after fix
ALTER TABLE problematic_table ENABLE ROW LEVEL SECURITY;
```

---

## When to Review This

- ✅ Before adding client-side Supabase access
- ✅ Before enabling Supabase Auth
- ✅ After security incidents
- ✅ During architecture changes
- ✅ Every 6 months (routine review)

---

## Resources

- Full audit: `docs/security-review-supabase-auth.md`
- Action plan: `docs/SECURITY-ACTION-PLAN.md`
- Summary: `docs/SECURITY-SUMMARY.md`
- Supabase RLS docs: https://supabase.com/docs/guides/auth/row-level-security

---

**Quick Reference Version:** 1.0
**Last Updated:** 2026-01-18
