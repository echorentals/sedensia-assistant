# Phase 3 Dashboard UI - Implementation Corrections

> **For Claude Code:** Apply these corrections when implementing the Phase 3 Dashboard UI plan. These address auth issues, database fixes, UI component bugs, and configuration problems.

---

## 1. Fix Login Action Return Type

In `dashboard/app/(auth)/login/actions.ts`, add explicit return type:

```typescript
export async function login(formData: FormData): Promise<{ error: string } | never> {
```

---

## 2. Fix Login Page Form Handler

In `dashboard/app/(auth)/login/page.tsx`, wrap the submit handler in try/catch:

```typescript
async function handleSubmit(formData: FormData) {
  setLoading(true);
  setError(null);
  try {
    const result = await login(formData);
    if (result?.error) {
      setError(result.error);
    }
  } catch (e) {
    // redirect() throws NEXT_REDIRECT which is expected behavior
  } finally {
    setLoading(false);
  }
}
```

---

## 3. Finalize Route Group Structure

Create this exact folder structure (the plan mentions it but doesn't fully implement):

```
dashboard/app/
├── (auth)/
│   ├── layout.tsx        # Minimal layout without nav
│   └── login/
│       ├── page.tsx
│       └── actions.ts
├── (dashboard)/
│   ├── layout.tsx        # Layout WITH Nav sidebar
│   ├── page.tsx
│   ├── jobs/
│   ├── estimates/
│   ├── contacts/
│   └── pricing/
├── layout.tsx            # Root layout (html/body only)
└── globals.css
```

Create `dashboard/app/(auth)/layout.tsx`:

```typescript
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
```

---

## 4. Skip Task 16 SQL - Create Admin User via Dashboard

Do **NOT** use the raw SQL in Task 16 to create admin user. The SQL is incorrect and will fail.

Instead:
- Go to Supabase Dashboard → Authentication → Users → Add User
- Or use `supabase.auth.admin.createUser()` from a script with service role key

---

## 5. Add Session Check to Dashboard Pages

Add this pattern to each dashboard page for defense in depth:

```typescript
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function SomeDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    redirect('/login');
  }
  
  // Continue with data fetching...
}
```

Apply to:
- `dashboard/app/(dashboard)/page.tsx`
- `dashboard/app/(dashboard)/jobs/page.tsx`
- `dashboard/app/(dashboard)/estimates/page.tsx`
- `dashboard/app/(dashboard)/contacts/page.tsx`
- `dashboard/app/(dashboard)/pricing/page.tsx`

---

## 6. Improve Middleware Error Handling

In `dashboard/middleware.ts`, exclude static assets and handle errors more gracefully:

```typescript
if (
  !user &&
  !request.nextUrl.pathname.startsWith('/login') &&
  !request.nextUrl.pathname.startsWith('/_next') &&
  !request.nextUrl.pathname.includes('.')
) {
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  return NextResponse.redirect(url);
}
```

---

---

## 7. Use `gen_random_uuid()` Instead of `uuid_generate_v4()`

In `supabase/migrations/004_jobs_table.sql`, the plan uses `uuid_generate_v4()` which requires the `uuid-ossp` extension.

**Fix:** Use built-in Postgres function instead:

```sql
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- rest of table...
);
```

---

## 8. Fix Circular/Dynamic Imports in Callbacks

Task 6 and 7 use dynamic imports inside command handlers inconsistently:

```typescript
const { createJob } = await import('../../db/index.js');
```

**Fix:** Import at the top of `src/modules/telegram/callbacks.ts`:

```typescript
import { 
  createJob, 
  getActiveJobs, 
  findJobByPrefix, 
  updateJobStage, 
  updateJobEta 
} from '../../db/index.js';
```

---

## 9. Add Error Handling to Server Actions

In `dashboard/app/(dashboard)/jobs/actions.ts`, add error handling:

```typescript
export async function updateJobStage(jobId: string, stage: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('jobs')
    .update({ stage, updated_at: new Date().toISOString() })
    .eq('id', jobId);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath('/jobs');
  return { success: true };
}

export async function updateJobEta(jobId: string, eta: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('jobs')
    .update({ eta, updated_at: new Date().toISOString() })
    .eq('id', jobId);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath('/jobs');
  return { success: true };
}
```

---

## 10. Fix Select Component in JobsTable

The plan puts a Badge directly inside SelectTrigger which won't render correctly.

**Fix:** In `dashboard/components/jobs-table.tsx`:

```tsx
<Select
  value={job.stage}
  onValueChange={(value) => handleStageChange(job.id, value)}
>
  <SelectTrigger className="w-40">
    <SelectValue>
      <Badge className={stageColors[job.stage]}>
        {stageLabels[job.stage]}
      </Badge>
    </SelectValue>
  </SelectTrigger>
  <SelectContent>
    {Object.entries(stageLabels).map(([value, label]) => (
      <SelectItem key={value} value={value}>
        {label}
      </SelectItem>
    ))}
  </SelectContent>
</Select>
```

---

## 11. Fix Contact Dialog - Close After Submit

The contact dialog doesn't close after successful submission. Convert to controlled dialog.

**Fix:** In `dashboard/app/(dashboard)/contacts/page.tsx`, make it a client component or extract form to client component:

```tsx
'use client';

import { useState } from 'react';
// ... other imports

export function AddContactDialog() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    const result = await addContact(formData);
    if (result?.error) {
      setError(result.error);
    } else {
      setOpen(false);
      setError(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Add Contact
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Contact</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-4">
          {/* form fields */}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full">Add Contact</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

Then update `addContact` action to return `{ success: true }` or `{ error: string }`.

---

## 12. Add Types to Pricing Page

In `dashboard/app/(dashboard)/pricing/page.tsx`, replace `any` with proper types:

```typescript
interface PricingHistoryItem {
  id: string;
  description: string | null;
  width_inches: number | null;
  height_inches: number | null;
  unit_price: number | null;
  outcome: 'won' | 'lost' | 'pending';
  sign_type: { name: string } | null;
  material: { name: string } | null;
}

// Then use:
{history.map((item: PricingHistoryItem) => (
```

---

## 13. Add Loading States

Create loading files for each dashboard route:

`dashboard/app/(dashboard)/loading.tsx`:
```tsx
export default function Loading() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900"></div>
    </div>
  );
}
```

Copy to or create similar files for:
- `dashboard/app/(dashboard)/jobs/loading.tsx`
- `dashboard/app/(dashboard)/estimates/loading.tsx`
- `dashboard/app/(dashboard)/contacts/loading.tsx`
- `dashboard/app/(dashboard)/pricing/loading.tsx`

---

## 14. Fix Netlify Config

In `netlify.toml`, simplify the config - let the plugin handle publish directory:

```toml
[build]
  base = "dashboard"
  command = "npm run build"

[[plugins]]
  package = "@netlify/plugin-nextjs"

[build.environment]
  NODE_VERSION = "20"
```

---

## 15. Verify Backend Uses Service Role Key

After enabling RLS in Task 17, the backend will fail if using anon key.

**Verify** in `src/db/client.ts`:
```typescript
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!  // NOT anon key
);
```

Ensure `.env` has `SUPABASE_SERVICE_ROLE_KEY` set.

---

## 16. Remove Dead Link or Create Estimate Detail Page

The estimates table links to `/estimates/${estimate.id}` but that page doesn't exist.

**Option A:** Remove the link in `dashboard/components/estimates-table.tsx`

**Option B:** Create `dashboard/app/(dashboard)/estimates/[id]/page.tsx`:

```tsx
import { createClient } from '@/lib/supabase/server';
import { redirect, notFound } from 'next/navigation';

export default async function EstimateDetailPage({ 
  params 
}: { 
  params: { id: string } 
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) redirect('/login');

  const { data: estimate } = await supabase
    .from('estimates')
    .select('*, contact:contacts(*)')
    .eq('id', params.id)
    .single();

  if (!estimate) notFound();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Estimate Details</h1>
      {/* Render estimate details */}
    </div>
  );
}
```

---

## 17. Configure Dashboard Dev Port

Add port configuration to avoid conflict with backend (which may use 3000).

In `dashboard/package.json`, update scripts:

```json
{
  "scripts": {
    "dev": "next dev -p 3001",
    "build": "next build",
    "start": "next start -p 3001",
    "lint": "next lint"
  }
}
```

---

## 18. Ensure date-fns Imports

Verify all files using `format` have the import. Add to:

- `dashboard/components/jobs-table.tsx`
- `dashboard/components/estimates-table.tsx`

```typescript
import { format } from 'date-fns';
```

---

## Summary Checklist

### Auth Fixes
- [ ] Add return type to login action
- [ ] Add try/catch to login form handler
- [ ] Create `(auth)` route group with minimal layout
- [ ] Move login page to `(auth)/login/`
- [ ] Create `(dashboard)` route group with nav layout
- [ ] Move all dashboard pages to `(dashboard)/`
- [ ] Skip SQL user creation, use Supabase Dashboard instead
- [ ] Add session checks to all dashboard pages
- [ ] Update middleware to exclude static assets

### Database & Backend Fixes
- [ ] Use `gen_random_uuid()` instead of `uuid_generate_v4()`
- [ ] Fix imports in callbacks.ts (no dynamic imports)
- [ ] Verify backend uses service role key after RLS enabled

### UI/Component Fixes
- [ ] Add error handling to server actions
- [ ] Fix Select component in JobsTable (use SelectValue)
- [ ] Fix contact dialog to close after submit
- [ ] Add proper types to pricing page (no `any`)
- [ ] Add loading.tsx files for all routes
- [ ] Remove dead estimate link OR create detail page
- [ ] Ensure date-fns imports in all files

### Config Fixes
- [ ] Simplify netlify.toml
- [ ] Add port 3001 to dashboard package.json scripts
