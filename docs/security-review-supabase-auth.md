# Supabase Authentication & Authorization Security Review

**Project:** Sedensia Assistant
**Review Date:** 2026-01-18
**Reviewer:** Claude Code (Security Architect)
**Scope:** Supabase RLS policies, service role key usage, and data access patterns

---

## Executive Summary

This security review identifies **CRITICAL vulnerabilities** in the current Supabase implementation. The project uses the service role key exclusively for all database operations, which bypasses Row Level Security (RLS) policies entirely. Additionally, two sensitive tables (`oauth_tokens` and `app_state`) have NO RLS policies configured, creating a severe security gap if the authentication model changes.

### Risk Level: **HIGH** 🔴

**Critical Issues Found:**
1. ❌ **No RLS policies on `oauth_tokens` table** (contains encrypted OAuth credentials)
2. ❌ **No RLS policies on `app_state` table** (contains runtime state)
3. ⚠️ **Service role key used for all operations** (bypasses RLS entirely)
4. ⚠️ **Missing INSERT/DELETE policies** on several tables
5. ⚠️ **Incomplete RLS coverage** for `jobs` table

**Current Security Posture:**
- The project is a **backend service** with no client-side Supabase access
- All database operations use the service role key (bypasses RLS)
- Encryption is properly implemented for OAuth tokens
- RLS policies exist but are **never enforced** due to service role usage

---

## Architecture Context

### Current Implementation
```typescript
// src/db/client.ts
export const supabase = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY  // ⚠️ Service role bypasses ALL RLS
);
```

**Key Characteristics:**
- **Backend-only service** (Fastify server)
- No browser/client access to Supabase
- All operations via server-side Node.js
- Service role key never exposed to clients
- Single-tenant application (one business user)

**Access Patterns:**
- Gmail webhook → Server → Supabase (service role)
- Telegram bot → Server → Supabase (service role)
- QuickBooks API → Server → Supabase (service role)

---

## Detailed Findings

### 1. ❌ CRITICAL: Missing RLS on `oauth_tokens` Table

**Severity:** CRITICAL
**Impact:** Complete exposure of OAuth credentials if authentication model changes

**Current State:**
```sql
-- supabase/migrations/001_initial_schema.sql
CREATE TABLE oauth_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider TEXT NOT NULL CHECK (provider IN ('gmail', 'quickbooks')),
  access_token TEXT NOT NULL,      -- ⚠️ Contains encrypted tokens
  refresh_token TEXT NOT NULL,     -- ⚠️ Contains encrypted tokens
  token_type TEXT DEFAULT 'Bearer',
  expires_at TIMESTAMPTZ NOT NULL,
  scope TEXT,
  realm_id TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(provider, realm_id)
);
-- ❌ NO RLS ENABLED
-- ❌ NO POLICIES CONFIGURED
```

**Why This Matters:**
- Contains encrypted OAuth tokens for Gmail and QuickBooks
- If RLS is not enabled, ANY authenticated user could read/modify tokens
- Even with encryption, token exposure enables:
  - Account takeover via refresh tokens
  - Unauthorized QuickBooks/Gmail API access
  - Business email compromise

**Encryption Is Not Enough:**
```typescript
// src/modules/gmail/tokens.ts
export async function getGmailTokens(): Promise<GmailTokens | null> {
  const { data, error } = await supabase
    .from('oauth_tokens')
    .select('*')
    .eq('provider', 'gmail')
    .is('realm_id', null)
    .single();

  // Tokens are encrypted, but RLS should prevent unauthorized reads
  return {
    accessToken: decrypt(data.access_token),  // AES-256-GCM decryption
    refreshToken: decrypt(data.refresh_token),
    // ...
  };
}
```

**Recommendation:**
```sql
-- Enable RLS on oauth_tokens
ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;

-- Deny all access by default (defense in depth)
CREATE POLICY "Deny all direct access to oauth_tokens"
  ON oauth_tokens
  FOR ALL
  TO public, authenticated
  USING (false)
  WITH CHECK (false);

-- Service role still has full access (bypasses RLS)
-- But if anon/authenticated keys are ever added, tokens are protected
```

---

### 2. ❌ CRITICAL: Missing RLS on `app_state` Table

**Severity:** HIGH
**Impact:** Potential information disclosure or state tampering

**Current State:**
```sql
-- supabase/migrations/002_app_state.sql
CREATE TABLE app_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- ❌ NO RLS ENABLED
-- ❌ NO POLICIES CONFIGURED
```

**Why This Matters:**
- Stores runtime state like Gmail watch `historyId`
- Could contain sensitive operational data
- No access controls = potential for state tampering

**Recommendation:**
```sql
ALTER TABLE app_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Deny all direct access to app_state"
  ON app_state
  FOR ALL
  TO public, authenticated
  USING (false)
  WITH CHECK (false);
```

---

### 3. ⚠️ HIGH: Service Role Key Bypasses All RLS

**Severity:** HIGH (current), CRITICAL (if client access is added)
**Impact:** RLS policies are never enforced in current implementation

**Current Pattern:**
Every database operation uses the service role key, which **completely bypasses RLS**:

```typescript
// src/db/client.ts
export const supabase = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY  // ⚠️ Bypasses ALL RLS policies
);

// All modules import this client
import { supabase } from './client.js';
```

**Why This Is Risky:**

1. **RLS policies are untested**: They exist but never execute in production
2. **False sense of security**: Developers may assume policies are protecting data
3. **No defense in depth**: If service role key is compromised, game over
4. **Future-proofing failure**: Adding client access later requires complete policy review

**Current RLS Policies (Never Enforced):**
```sql
-- supabase/migrations/005_rls_policies.sql
CREATE POLICY "Authenticated users can read contacts" ON contacts
  FOR SELECT TO authenticated USING (true);
-- ⚠️ This policy is NEVER checked because service role bypasses RLS
```

**When Service Role Is Appropriate:**
- ✅ Backend-only operations (current use case)
- ✅ Admin/system operations
- ✅ Batch jobs and migrations
- ✅ Server-to-server integrations

**When You MUST NOT Use Service Role:**
- ❌ Client-side JavaScript (browser/mobile)
- ❌ Untrusted API clients
- ❌ Multi-tenant scenarios with user isolation
- ❌ Any context where users should have restricted access

**Recommendation:**
```typescript
// Keep current implementation (service role is correct here)
// But add explicit documentation:

/**
 * Supabase client configured with SERVICE ROLE key.
 *
 * ⚠️ SECURITY NOTICE:
 * - This client BYPASSES all Row Level Security (RLS) policies
 * - Has unrestricted read/write access to all tables
 * - MUST ONLY be used in trusted server-side code
 * - NEVER expose this client or its key to client-side code
 *
 * For client-side access (if ever needed):
 * - Use SUPABASE_ANON_KEY instead
 * - Ensure all RLS policies are properly configured and tested
 * - Implement Supabase Auth for user authentication
 */
export const supabase = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
);
```

---

### 4. ⚠️ MEDIUM: Incomplete RLS Policies

**Severity:** MEDIUM
**Impact:** Policies exist but don't cover all operations

**Current Policy Coverage:**

| Table | RLS Enabled | SELECT | INSERT | UPDATE | DELETE |
|-------|-------------|--------|--------|--------|--------|
| `contacts` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `estimates` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `jobs` | ✅ | ✅ | ❌ | ✅ | ❌ |
| `sign_types` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `materials` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `pricing_history` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `telegram_users` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `oauth_tokens` | ❌ | ❌ | ❌ | ❌ | ❌ |
| `app_state` | ❌ | ❌ | ❌ | ❌ | ❌ |

**Analysis:**

1. **`telegram_users` has SERVICE_ROLE-only policy:**
   ```sql
   -- supabase/migrations/006_telegram_users.sql
   CREATE POLICY "Service role has full access to telegram_users"
     ON telegram_users
     FOR ALL
     TO service_role
     USING (true)
     WITH CHECK (true);
   ```
   ✅ This is correct! Explicitly restricts access to service role.

2. **Other tables use broad `authenticated` policies:**
   ```sql
   CREATE POLICY "Authenticated users can read contacts" ON contacts
     FOR SELECT TO authenticated USING (true);
   ```
   ⚠️ These allow ANY authenticated user full access (but never enforced due to service role usage)

3. **Missing INSERT policies for user-generated content:**
   - No policy for creating `jobs` (but code does create jobs)
   - No policy for creating `estimates` (but code does create estimates)
   - No policy for updating `pricing_history` outcomes

**Recommendation:**

Since this is a **single-tenant, backend-only application**, the current approach is acceptable BUT should be documented:

```sql
-- Add comments to migration file
-- Note: These policies are not enforced in production because all operations
-- use the service role key. They exist as:
-- 1. Documentation of intended access patterns
-- 2. Safety net if client-side access is added in the future
-- 3. Defense in depth principle

-- For production use with authenticated users, add:
CREATE POLICY "Service role can insert jobs" ON jobs
  FOR INSERT TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can insert estimates" ON estimates
  FOR INSERT TO service_role
  USING (true)
  WITH CHECK (true);
```

---

### 5. ✅ GOOD: Proper Encryption Implementation

**What's Working Well:**

```typescript
// src/utils/encryption.ts
const ALGORITHM = 'aes-256-gcm';  // ✅ Strong authenticated encryption
const IV_LENGTH = 16;              // ✅ Proper IV size
const AUTH_TAG_LENGTH = 16;        // ✅ GCM authentication tag

export function encrypt(text: string): string {
  const iv = randomBytes(IV_LENGTH);  // ✅ Random IV per encryption
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();  // ✅ Authenticated encryption

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}
```

**Strengths:**
- ✅ AES-256-GCM (authenticated encryption)
- ✅ Random IV for each encryption
- ✅ Proper key derivation (64 hex chars = 256 bits)
- ✅ Auth tag validation on decryption
- ✅ Comprehensive error handling

**Encryption Key Security:**
```typescript
// .env.example
ENCRYPTION_KEY=xxx  # Generated with: openssl rand -hex 32
```

⚠️ **Recommendation:** Add key rotation plan and document key backup procedures.

---

### 6. ✅ GOOD: No Client-Side Exposure

**Current Architecture:**
```
┌─────────────┐
│   Client    │
│ (Telegram/  │
│  Gmail)     │
└──────┬──────┘
       │
       ▼
┌──────────────────────────────────────┐
│   Fastify Server (Backend Only)      │
│                                      │
│   ┌─────────────────────────────┐   │
│   │  Service Role Key (Server)  │   │
│   │  ❌ Never exposed to client │   │
│   └────────────┬────────────────┘   │
│                ▼                     │
│         ┌─────────────┐              │
│         │  Supabase   │              │
│         │  Database   │              │
│         └─────────────┘              │
└──────────────────────────────────────┘
```

**Why This Is Secure:**
- ✅ Service role key is server-side only
- ✅ No `SUPABASE_ANON_KEY` in environment
- ✅ No client-side Supabase SDK usage
- ✅ All database access mediated by backend

**Verification:**
```bash
$ grep -r "SUPABASE_ANON_KEY" src/
# No results ✅

$ grep -r "createClient" src/
src/db/client.ts:export const supabase = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY  # Only service role ✅
);
```

---

## Environment Variable Security

**Current Configuration:**
```typescript
// src/config/env.ts
const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),  // ✅ Validated
  ENCRYPTION_KEY: z.string().length(64),         // ✅ Length enforced
  // ...
});
```

**Security Checklist:**
- ✅ Environment variables validated with Zod
- ✅ Service role key required (not optional)
- ✅ Encryption key length enforced (64 hex chars)
- ✅ No hardcoded credentials in codebase
- ⚠️ `.env` file must be in `.gitignore`

**Verification Needed:**
```bash
$ cat .gitignore | grep .env
# Should show: .env (not just .env.example)
```

---

## Threat Model Analysis

### Threat 1: Service Role Key Compromise

**Attack Vector:** Service role key leaked via environment variable exposure, logs, or code repository

**Impact:**
- ❌ Complete database access (read/write/delete)
- ❌ Ability to decrypt OAuth tokens (with encryption key)
- ❌ Modify job statuses, estimates, pricing
- ❌ Impersonate QuickBooks/Gmail integrations

**Current Mitigations:**
- ✅ Key stored in environment variables only
- ✅ Not in version control
- ✅ Server-side only (never client-exposed)

**Recommended Mitigations:**
- 🔧 Implement secret rotation schedule (every 90 days)
- 🔧 Use secret management service (AWS Secrets Manager, HashiCorp Vault)
- 🔧 Monitor Supabase audit logs for suspicious queries
- 🔧 Implement rate limiting on database operations
- 🔧 Set up alerts for unusual query patterns

### Threat 2: SQL Injection

**Attack Vector:** Malicious input in email parsing, Telegram commands, or QuickBooks data

**Impact:**
- ❌ Supabase client uses parameterized queries (✅ safe by default)
- ⚠️ Risk if raw SQL is used anywhere

**Current Mitigations:**
- ✅ All database access via Supabase query builder (parameterized)
- ✅ No raw SQL in application code
- ✅ Input validation via AI parsing (Claude API)

**Code Review:**
```typescript
// ✅ SAFE: Parameterized query
const { data } = await supabase
  .from('contacts')
  .select('*')
  .eq('email', cleanEmail)  // ✅ Automatically parameterized
  .single();

// ❌ UNSAFE: Raw SQL (not found in codebase ✅)
// await supabase.rpc('raw_query', { sql: `SELECT * FROM contacts WHERE email = '${email}'` })
```

**Recommendation:** ✅ Continue using query builder, avoid raw SQL.

### Threat 3: Encryption Key Compromise

**Attack Vector:** Encryption key leaked separately from service role key

**Impact:**
- ❌ Decrypt OAuth tokens from database
- ❌ Create forged encrypted tokens

**Current Mitigations:**
- ✅ 256-bit encryption key (AES-256-GCM)
- ✅ Stored separately in environment variables
- ✅ Key validation enforced (must be 64 hex chars)

**Recommended Mitigations:**
- 🔧 Store encryption key in separate secret management system
- 🔧 Implement key rotation with backward compatibility
- 🔧 Consider using Supabase Vault for key storage
- 🔧 Encrypt backups separately (database backups contain encrypted tokens)

### Threat 4: Privilege Escalation (Future Risk)

**Attack Vector:** Adding client-side access or authenticated users without proper RLS

**Impact:**
- ⚠️ Current RLS policies are untested (never enforced)
- ⚠️ `oauth_tokens` has NO RLS (complete exposure)
- ⚠️ Broad `authenticated` policies allow all operations

**Current Mitigations:**
- ✅ Service role only (no authenticated users)
- ✅ Backend-only architecture

**Recommended Mitigations:**
- 🔧 **BEFORE adding any client-side access:**
  1. Enable RLS on `oauth_tokens` and `app_state`
  2. Test ALL RLS policies with authenticated role
  3. Replace broad `USING (true)` policies with specific rules
  4. Implement user authentication (Supabase Auth)
  5. Use anon/authenticated keys for client access

---

## Compliance & Best Practices

### Supabase Security Best Practices

| Best Practice | Status | Notes |
|---------------|--------|-------|
| Enable RLS on all tables | ⚠️ Partial | Missing on `oauth_tokens`, `app_state` |
| Use service role only for backend | ✅ Correct | No client access |
| Store service role key securely | ✅ Correct | Environment variables only |
| Encrypt sensitive data at rest | ✅ Correct | AES-256-GCM for OAuth tokens |
| Implement audit logging | ❌ Missing | No Supabase audit log monitoring |
| Rotate credentials regularly | ❌ Missing | No rotation schedule documented |
| Test RLS policies | ❌ Not applicable | Service role bypasses RLS |
| Use specific RLS policies | ⚠️ Partial | Many policies use `USING (true)` |

### OAuth Security Best Practices

| Best Practice | Status | Notes |
|---------------|--------|-------|
| Encrypt tokens at rest | ✅ Correct | AES-256-GCM encryption |
| Use HTTPS for OAuth callbacks | ⚠️ Unknown | Check production deployment |
| Validate OAuth state parameter | ⚠️ Unknown | Not visible in callback handlers |
| Implement token refresh | ✅ Correct | Both Gmail and QuickBooks support refresh |
| Secure token storage | ✅ Correct | Encrypted in database |
| Restrict OAuth scopes | ⚠️ Unknown | Check actual scope requests |

---

## Recommendations Summary

### Immediate Actions (CRITICAL)

1. **Enable RLS on `oauth_tokens` table:**
   ```sql
   ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;

   CREATE POLICY "Deny all direct access to oauth_tokens"
     ON oauth_tokens FOR ALL TO public, authenticated
     USING (false) WITH CHECK (false);
   ```

2. **Enable RLS on `app_state` table:**
   ```sql
   ALTER TABLE app_state ENABLE ROW LEVEL SECURITY;

   CREATE POLICY "Deny all direct access to app_state"
     ON app_state FOR ALL TO public, authenticated
     USING (false) WITH CHECK (false);
   ```

3. **Document service role usage:**
   Add explicit security comments to `src/db/client.ts` explaining why service role is used and when it should NOT be used.

### Short-Term Actions (HIGH Priority)

4. **Verify `.env` is in `.gitignore`:**
   Ensure service role key and encryption key are never committed.

5. **Implement secret rotation:**
   Create runbook for rotating service role key and encryption key.

6. **Add complete INSERT/UPDATE/DELETE policies:**
   Define explicit policies for all operations, even if not enforced (future-proofing).

7. **Set up monitoring:**
   Configure Supabase alerts for unusual database access patterns.

### Medium-Term Actions (MEDIUM Priority)

8. **Implement audit logging:**
   Log all sensitive operations (OAuth token access, job creation, etc.).

9. **Add OAuth state validation:**
   Verify OAuth callback handlers validate the state parameter.

10. **Test RLS policies in staging:**
    Create a test suite that validates RLS policies with authenticated role.

11. **Document threat model:**
    Create formal threat model document with attack trees.

### Long-Term Considerations (LOW Priority)

12. **Consider Supabase Vault:**
    Migrate encryption key storage to Supabase Vault for better key management.

13. **Implement database backup encryption:**
    Ensure backups are encrypted separately (they contain encrypted OAuth tokens).

14. **Add rate limiting:**
    Implement rate limiting on critical endpoints (webhooks, OAuth callbacks).

15. **Security training:**
    Document when to use service role vs anon key for future developers.

---

## Migration Script

```sql
-- Migration: 007_critical_rls_fixes.sql
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
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can insert estimates"
  ON estimates
  FOR INSERT
  TO service_role
  USING (true)
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
```

---

## Testing Checklist

Before deploying RLS changes, verify:

- [ ] Run migration `007_critical_rls_fixes.sql` in staging
- [ ] Verify existing application functionality (service role should still work)
- [ ] Test that authenticated role CANNOT access `oauth_tokens`
- [ ] Test that authenticated role CANNOT access `app_state`
- [ ] Verify service role can still read/write all tables
- [ ] Check application logs for RLS-related errors
- [ ] Test OAuth flows (Gmail and QuickBooks)
- [ ] Test Telegram bot commands
- [ ] Test Gmail webhook processing
- [ ] Backup database before production deployment

---

## Conclusion

**Overall Security Posture: MODERATE** ⚠️

The application has **good foundational security** (encryption, backend-only access, no client exposure) but has **critical gaps** in Row Level Security coverage. The missing RLS policies on `oauth_tokens` and `app_state` create a significant risk if the authentication model ever changes or if an authenticated user role is added.

**Key Strengths:**
- ✅ Service role usage is appropriate for backend-only architecture
- ✅ Strong encryption implementation (AES-256-GCM)
- ✅ No client-side exposure of credentials
- ✅ Proper environment variable validation

**Critical Weaknesses:**
- ❌ No RLS on `oauth_tokens` (contains encrypted OAuth credentials)
- ❌ No RLS on `app_state` (contains runtime state)
- ⚠️ RLS policies are never enforced (service role bypass)
- ⚠️ Incomplete policy coverage for INSERT/UPDATE/DELETE

**Recommended Priority:**
1. **Immediate:** Apply migration `007_critical_rls_fixes.sql`
2. **Short-term:** Document service role usage and implement secret rotation
3. **Medium-term:** Add audit logging and monitoring
4. **Long-term:** Migrate to managed secret storage (Vault)

**Final Recommendation:**
Apply the critical RLS fixes immediately. While the current architecture is secure (backend-only with service role), the missing RLS policies create technical debt and future risk. Enabling RLS on `oauth_tokens` and `app_state` provides defense-in-depth and ensures the application remains secure if the access model evolves.

---

## Appendix: RLS Testing Guide

If you ever add authenticated user access, test RLS policies with:

```typescript
// Create test client with anon key (NOT service role)
const testClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!  // Use anon key to test RLS
);

// Attempt to access oauth_tokens (should be denied)
const { data, error } = await testClient
  .from('oauth_tokens')
  .select('*');

// Expected: error with code "42501" (insufficient_privilege)
console.assert(error?.code === '42501', 'RLS policy should deny access');

// Authenticate as a user
await testClient.auth.signInWithPassword({
  email: 'test@example.com',
  password: 'password'
});

// Attempt to access oauth_tokens again (should still be denied)
const { data: data2, error: error2 } = await testClient
  .from('oauth_tokens')
  .select('*');

// Expected: still denied (authenticated role has deny-all policy)
console.assert(error2?.code === '42501', 'RLS policy should deny authenticated access');
```

**Note:** This test suite requires:
1. Supabase Auth enabled
2. Test user account created
3. `SUPABASE_ANON_KEY` environment variable

---

**Document Version:** 1.0
**Last Updated:** 2026-01-18
**Next Review:** After implementing critical fixes
