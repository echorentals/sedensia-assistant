import { createClient } from '@supabase/supabase-js';
import { env } from '../config/index.js';

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
export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
