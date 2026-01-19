# Security Action Plan - Supabase RLS Fixes

**Status:** CRITICAL FIXES REQUIRED
**Review Date:** 2026-01-18
**Estimated Time:** 30 minutes

---

## TL;DR

Two critical tables (`oauth_tokens` and `app_state`) have NO Row Level Security policies configured. While the current backend-only architecture is safe, this creates a significant vulnerability if the access model ever changes.

**Impact:** If authenticated user access is added without fixing RLS, OAuth tokens and app state would be completely exposed.

**Solution:** Apply migration `007_critical_rls_fixes.sql` to enable RLS on these tables.

---

## Critical Findings

### ❌ Issue 1: Missing RLS on `oauth_tokens`
- Contains encrypted Gmail and QuickBooks OAuth tokens
- No RLS policies = complete exposure to authenticated users
- Even encrypted, refresh tokens can be used for account takeover

### ❌ Issue 2: Missing RLS on `app_state`
- Contains runtime state (Gmail watch historyId, etc.)
- No RLS policies = potential for state tampering

### ⚠️ Issue 3: Service Role Bypasses RLS
- All operations use service role key (bypasses RLS entirely)
- RLS policies exist but are NEVER enforced in production
- Acceptable for backend-only architecture, but creates false sense of security

---

## Immediate Actions

### Step 1: Review the Security Audit

Read the full security review:
```bash
open docs/security-review-supabase-auth.md
```

### Step 2: Apply Critical RLS Fixes

**Prerequisites:**
- [ ] Database backup completed
- [ ] Tested in staging environment
- [ ] Application downtime window scheduled (optional, should be zero-downtime)

**Apply Migration:**
```bash
# Using Supabase CLI
supabase migration new critical_rls_fixes
# Copy contents from supabase/migrations/007_critical_rls_fixes.sql

# Or apply directly to production
supabase db push
```

**Verification:**
```sql
-- Verify RLS is enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('oauth_tokens', 'app_state');

-- Expected: Both should show rowsecurity = true

-- Verify policies exist
SELECT tablename, policyname, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('oauth_tokens', 'app_state');

-- Expected: "Deny all direct access" policies for both tables
```

### Step 3: Update Database Client Documentation

Add security warning to `src/db/client.ts`:

```typescript
/**
 * Supabase client configured with SERVICE ROLE key.
 *
 * ⚠️ SECURITY NOTICE:
 * - This client BYPASSES all Row Level Security (RLS) policies
 * - Has unrestricted read/write access to all tables
 * - MUST ONLY be used in trusted server-side code
 * - NEVER expose this client or its key to client-side code
 *
 * RLS Policies:
 * - All tables have RLS enabled for defense-in-depth
 * - Policies deny access to authenticated/public roles
 * - Service role bypasses RLS (as designed for backend operations)
 *
 * For client-side access (if ever needed):
 * - Use SUPABASE_ANON_KEY instead
 * - Test ALL RLS policies with authenticated role
 * - Review docs/security-review-supabase-auth.md
 */
export const supabase = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
);
```

### Step 4: Verify .gitignore

Ensure `.env` is NOT committed:
```bash
# Check .gitignore
grep -q "^\.env$" .gitignore && echo "✅ .env is ignored" || echo "❌ Add .env to .gitignore"

# Check if .env is tracked
git ls-files .env && echo "❌ CRITICAL: .env is tracked! Remove it!" || echo "✅ .env is not tracked"
```

If `.env` is tracked:
```bash
# Remove from git (but keep locally)
git rm --cached .env
git commit -m "security: remove .env from version control"

# Add to .gitignore if not already there
echo ".env" >> .gitignore
git add .gitignore
git commit -m "security: ensure .env is ignored"
```

---

## Short-Term Actions (Within 1 Week)

### 1. Implement Secret Rotation Schedule

Create runbook in `docs/runbooks/secret-rotation.md`:

**Secrets to Rotate:**
- `SUPABASE_SERVICE_ROLE_KEY` (every 90 days)
- `ENCRYPTION_KEY` (every 180 days, with backward compatibility)
- `TELEGRAM_BOT_TOKEN` (if compromised)
- OAuth credentials (Google/QuickBooks) (annually)

**Rotation Process:**
1. Generate new secret in Supabase Dashboard
2. Update staging environment
3. Test all integrations
4. Update production environment
5. Revoke old secret after 24-hour grace period

### 2. Set Up Monitoring

**Supabase Dashboard:**
- Enable database query logging (if not already enabled)
- Set up alerts for:
  - Unusual query patterns (> 1000 queries/min)
  - Failed authentication attempts
  - Large data exports

**Application Logging:**
```typescript
// Add to src/db/client.ts
import pino from 'pino';

const logger = pino();

// Wrapper for sensitive operations
export async function auditedQuery<T>(
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    logger.info({
      operation,
      duration: Date.now() - start,
      status: 'success'
    });
    return result;
  } catch (error) {
    logger.error({
      operation,
      duration: Date.now() - start,
      status: 'error',
      error: String(error)
    });
    throw error;
  }
}
```

### 3. Add OAuth State Validation

Update OAuth callback handlers to validate state parameter:

```typescript
// src/modules/gmail/auth.ts
import { randomBytes } from 'crypto';

const pendingStates = new Set<string>();

export function getAuthUrl(): string {
  const state = randomBytes(16).toString('hex');
  pendingStates.add(state);

  // Clean up old states after 10 minutes
  setTimeout(() => pendingStates.delete(state), 10 * 60 * 1000);

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    state,  // Add state parameter
  });
}

export async function handleAuthCallback(code: string, state: string): Promise<void> {
  // Validate state parameter
  if (!pendingStates.has(state)) {
    throw new Error('Invalid or expired state parameter - possible CSRF attack');
  }
  pendingStates.delete(state);

  // Continue with token exchange...
}
```

---

## Medium-Term Actions (Within 1 Month)

### 1. Implement Comprehensive Audit Logging

Create audit log table:
```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  operation TEXT NOT NULL,
  table_name TEXT,
  user_id TEXT,
  ip_address INET,
  changes JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS with service role access only
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage audit_logs"
  ON audit_logs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Index for querying
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX idx_audit_logs_operation ON audit_logs(operation);
```

Log critical operations:
```typescript
async function logAudit(operation: string, details: any) {
  await supabase.from('audit_logs').insert({
    operation,
    table_name: details.table,
    changes: details,
  });
}

// Usage
await logAudit('oauth_token_accessed', { provider: 'gmail' });
```

### 2. Test RLS Policies in Staging

Create test suite for RLS policies:
```typescript
// tests/security/rls-policies.test.ts
import { describe, test, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

describe('RLS Policies', () => {
  // Create client with ANON key (not service role)
  const anonClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!
  );

  test('oauth_tokens is not accessible to anonymous users', async () => {
    const { data, error } = await anonClient
      .from('oauth_tokens')
      .select('*');

    expect(error).toBeTruthy();
    expect(error?.code).toBe('42501'); // insufficient_privilege
    expect(data).toBeNull();
  });

  test('app_state is not accessible to anonymous users', async () => {
    const { data, error } = await anonClient
      .from('app_state')
      .select('*');

    expect(error).toBeTruthy();
    expect(error?.code).toBe('42501');
    expect(data).toBeNull();
  });

  // Test authenticated user access
  test('oauth_tokens is not accessible to authenticated users', async () => {
    // Sign in as test user
    await anonClient.auth.signInWithPassword({
      email: 'test@example.com',
      password: 'test-password'
    });

    const { data, error } = await anonClient
      .from('oauth_tokens')
      .select('*');

    expect(error).toBeTruthy();
    expect(error?.code).toBe('42501');
    expect(data).toBeNull();
  });
});
```

**Note:** This requires Supabase Auth to be enabled and test users created.

### 3. Database Backup Encryption

Ensure backups are encrypted:
```bash
# Supabase backups are encrypted by default
# Verify in Supabase Dashboard > Settings > Database > Backups

# For manual backups, use encryption:
pg_dump -h db.xxx.supabase.co -U postgres -d postgres | \
  openssl enc -aes-256-cbc -salt -pbkdf2 -out backup.sql.enc

# Restore:
openssl enc -d -aes-256-cbc -pbkdf2 -in backup.sql.enc | \
  psql -h db.xxx.supabase.co -U postgres -d postgres
```

---

## Long-Term Improvements (Within 3 Months)

### 1. Migrate to Managed Secret Storage

**Option A: AWS Secrets Manager**
```typescript
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

async function getSecret(secretName: string): Promise<string> {
  const client = new SecretsManagerClient({ region: 'us-east-1' });
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretName })
  );
  return response.SecretString!;
}

// Usage
const serviceRoleKey = await getSecret('supabase/service-role-key');
const encryptionKey = await getSecret('supabase/encryption-key');
```

**Option B: HashiCorp Vault**
```typescript
import vault from 'node-vault';

const vaultClient = vault({
  endpoint: process.env.VAULT_ADDR,
  token: process.env.VAULT_TOKEN,
});

async function getSecret(path: string): Promise<any> {
  const result = await vaultClient.read(path);
  return result.data;
}

// Usage
const { value: serviceRoleKey } = await getSecret('secret/supabase/service-role-key');
```

**Option C: Supabase Vault (Native)**
```sql
-- Store encryption key in Supabase Vault
SELECT vault.create_secret('encryption-key', 'your-256-bit-key-here');

-- Retrieve in application
SELECT decrypted_secret FROM vault.decrypted_secrets
WHERE name = 'encryption-key';
```

### 2. Implement Rate Limiting

Add rate limiting to critical endpoints:
```typescript
import rateLimit from '@fastify/rate-limit';

// In src/index.ts
await fastify.register(rateLimit, {
  max: 100,  // requests
  timeWindow: '1 minute',
  cache: 10000,  // number of cached IPs
});

// Stricter rate limit for OAuth callbacks
fastify.register(rateLimit, {
  max: 5,
  timeWindow: '15 minutes',
  keyGenerator: (request) => request.ip,
}, { prefix: '/auth' });
```

### 3. Security Training Documentation

Create `docs/security/README.md` with:
- When to use service role vs anon key
- How to handle sensitive data
- OAuth security best practices
- RLS policy design patterns
- Incident response procedures

---

## Testing Checklist

Before deploying to production:

### Pre-Deployment
- [ ] Database backup completed
- [ ] Migration tested in staging environment
- [ ] All tests pass (`npm test`)
- [ ] Type check passes (`npm run typecheck`)
- [ ] Lint passes (`npm run lint`)

### Post-Deployment
- [ ] Verify RLS is enabled on `oauth_tokens` and `app_state`
- [ ] Test Gmail OAuth flow (authorize and send test email)
- [ ] Test QuickBooks OAuth flow
- [ ] Test Telegram bot commands
- [ ] Test Gmail webhook processing
- [ ] Check application logs for RLS errors
- [ ] Verify no functionality regression

### Security Verification
- [ ] Confirm `.env` is not in git history
- [ ] Verify service role key is not exposed in logs
- [ ] Test that authenticated role CANNOT access `oauth_tokens`
- [ ] Test that authenticated role CANNOT access `app_state`
- [ ] Review Supabase dashboard for unusual query patterns

---

## Rollback Plan

If migration causes issues:

```sql
-- Rollback: Disable RLS on oauth_tokens
ALTER TABLE oauth_tokens DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all direct access to oauth_tokens" ON oauth_tokens;

-- Rollback: Disable RLS on app_state
ALTER TABLE app_state DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all direct access to app_state" ON app_state;
```

**Note:** Rollback should NOT be necessary, as enabling RLS with deny-all policies has no effect when service role is used (service role bypasses RLS).

---

## Success Criteria

Deployment is successful when:
- ✅ All tables have RLS enabled
- ✅ `oauth_tokens` and `app_state` have deny-all policies
- ✅ Application functions normally (no regressions)
- ✅ Service role can still access all tables
- ✅ No RLS errors in application logs
- ✅ Security documentation updated

---

## Questions & Answers

**Q: Will enabling RLS break existing functionality?**
A: No. The service role key bypasses ALL RLS policies, so existing functionality is unaffected.

**Q: Why add RLS if it's not enforced?**
A: Defense-in-depth. If the access model changes (e.g., adding client-side access), RLS policies provide immediate protection without code changes.

**Q: Can I skip this if we're never adding client access?**
A: Not recommended. Even backend-only apps benefit from RLS as a safeguard against:
- Accidental exposure of service role key
- Future architectural changes
- Compliance requirements (defense-in-depth principle)

**Q: How do I test RLS policies if service role bypasses them?**
A: Use the `SUPABASE_ANON_KEY` with a test client (see testing section above).

**Q: What if I need to add client-side access in the future?**
A:
1. Enable Supabase Auth
2. Create authenticated users
3. Test ALL RLS policies with authenticated role
4. Review and update policies as needed
5. Use `SUPABASE_ANON_KEY` for client access (NOT service role)

---

## Support

For questions or issues:
- Review: `docs/security-review-supabase-auth.md`
- Supabase RLS docs: https://supabase.com/docs/guides/auth/row-level-security
- Supabase Discord: https://discord.supabase.com

---

**Action Plan Version:** 1.0
**Last Updated:** 2026-01-18
**Next Review:** After implementing critical fixes
