# Phase 3: Dashboard UI - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Next.js dashboard for managing jobs, estimates, contacts, and pricing analytics.

**Architecture:** Next.js 14 App Router with Supabase direct connection. Dashboard lives in `dashboard/` folder of existing monorepo. Backend gets new jobs table and Telegram commands. Auth via Supabase with RLS policies.

**Tech Stack:** Next.js 14, Supabase, Tailwind CSS, shadcn/ui, Netlify

---

## Task 1: Create Next.js App

**Files:**
- Create: `dashboard/` directory with Next.js app

**Step 1: Initialize Next.js app**

```bash
cd /Users/patrickjeong/Development/sedensia-assistant
npx create-next-app@latest dashboard --typescript --tailwind --eslint --app --src-dir=false --import-alias="@/*"
```

When prompted:
- Would you like to use Turbopack? → No
- Would you like to customize the default import alias? → No

**Step 2: Verify app runs**

```bash
cd dashboard && npm run dev
```

Visit http://localhost:3001 (use different port than backend)
Expected: Next.js welcome page

**Step 3: Commit**

```bash
cd /Users/patrickjeong/Development/sedensia-assistant
git add dashboard/
git commit -m "feat: initialize Next.js dashboard app"
```

---

## Task 2: Install shadcn/ui and Dependencies

**Files:**
- Modify: `dashboard/package.json`
- Create: `dashboard/components/ui/`

**Step 1: Install shadcn/ui**

```bash
cd dashboard
npx shadcn@latest init
```

When prompted:
- Style: Default
- Base color: Slate
- CSS variables: Yes

**Step 2: Add essential components**

```bash
npx shadcn@latest add button card table badge input label dialog select tabs
```

**Step 3: Install additional dependencies**

```bash
npm install @supabase/supabase-js @supabase/ssr date-fns lucide-react
```

**Step 4: Verify build**

```bash
npm run build
```

Expected: Build succeeds

**Step 5: Commit**

```bash
cd /Users/patrickjeong/Development/sedensia-assistant
git add dashboard/
git commit -m "feat: add shadcn/ui components and dependencies"
```

---

## Task 3: Set Up Supabase Client

**Files:**
- Create: `dashboard/lib/supabase/client.ts`
- Create: `dashboard/lib/supabase/server.ts`
- Create: `dashboard/lib/supabase/middleware.ts`
- Create: `dashboard/.env.local.example`

**Step 1: Create browser client**

Create `dashboard/lib/supabase/client.ts`:
```typescript
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

**Step 2: Create server client**

Create `dashboard/lib/supabase/server.ts`:
```typescript
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from Server Component
          }
        },
      },
    }
  );
}
```

**Step 3: Create middleware helper**

Create `dashboard/lib/supabase/middleware.ts`:
```typescript
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (
    !user &&
    !request.nextUrl.pathname.startsWith('/login')
  ) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
```

**Step 4: Create middleware**

Create `dashboard/middleware.ts`:
```typescript
import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
```

**Step 5: Create env example**

Create `dashboard/.env.local.example`:
```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

**Step 6: Create actual .env.local**

Create `dashboard/.env.local` with real values from your Supabase project.

**Step 7: Commit**

```bash
git add dashboard/lib/ dashboard/middleware.ts dashboard/.env.local.example
git commit -m "feat: add Supabase client configuration"
```

---

## Task 4: Create Database Types

**Files:**
- Create: `dashboard/lib/database.types.ts`

**Step 1: Generate types from Supabase**

Use the Supabase MCP to generate TypeScript types, or create manually:

Create `dashboard/lib/database.types.ts`:
```typescript
export interface Contact {
  id: string;
  name: string;
  email: string;
  company: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Estimate {
  id: string;
  contact_id: string | null;
  gmail_message_id: string | null;
  quickbooks_estimate_id: string | null;
  quickbooks_doc_number: string | null;
  quickbooks_customer_id: string | null;
  status: 'draft' | 'sent' | 'won' | 'lost' | 'expired';
  total_amount: number | null;
  items: EstimateItem[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface EstimateItem {
  description: string;
  signType?: string;
  material?: string;
  width?: number;
  height?: number;
  quantity: number;
  unitPrice: number;
  suggestedPrice?: number;
  confidence?: 'high' | 'medium' | 'low';
}

export interface Job {
  id: string;
  estimate_id: string | null;
  contact_id: string | null;
  description: string;
  stage: 'pending' | 'in_production' | 'ready' | 'installed' | 'completed';
  eta: string | null;
  total_amount: number | null;
  quickbooks_invoice_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SignType {
  id: string;
  name: string;
  category: string | null;
  base_price_per_sqft: number | null;
  min_price: number | null;
}

export interface Material {
  id: string;
  name: string;
  price_multiplier: number;
}

export interface PricingHistory {
  id: string;
  sign_type_id: string | null;
  material_id: string | null;
  description: string | null;
  width_inches: number | null;
  height_inches: number | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  outcome: 'won' | 'lost' | 'pending';
  quickbooks_estimate_id: string | null;
  contact_id: string | null;
  created_at: string;
}

// Joined types for UI
export interface EstimateWithContact extends Estimate {
  contact: Contact | null;
}

export interface JobWithContact extends Job {
  contact: Contact | null;
  estimate: Estimate | null;
}
```

**Step 2: Commit**

```bash
git add dashboard/lib/database.types.ts
git commit -m "feat: add database TypeScript types"
```

---

## Task 5: Jobs Table Migration

**Files:**
- Create: `supabase/migrations/004_jobs_table.sql`

**Step 1: Create migration**

Create `supabase/migrations/004_jobs_table.sql`:
```sql
-- Jobs table for tracking won work
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  estimate_id UUID REFERENCES estimates(id),
  contact_id UUID REFERENCES contacts(id),
  description TEXT NOT NULL,
  stage TEXT CHECK (stage IN ('pending', 'in_production', 'ready', 'installed', 'completed')) DEFAULT 'pending',
  eta DATE,
  total_amount DECIMAL(10,2),
  quickbooks_invoice_id TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_jobs_stage ON jobs(stage);
CREATE INDEX idx_jobs_contact ON jobs(contact_id);
CREATE INDEX idx_jobs_estimate ON jobs(estimate_id);
```

**Step 2: Apply migration via Supabase MCP**

Use the Supabase MCP tool to apply the migration to project `judtklihyqaqrnctoepa`.

**Step 3: Verify table created**

Query: `SELECT * FROM jobs LIMIT 1;`

**Step 4: Commit**

```bash
git add supabase/migrations/004_jobs_table.sql
git commit -m "feat: add jobs table migration"
```

---

## Task 6: Update /won Command to Create Jobs

**Files:**
- Modify: `src/modules/telegram/callbacks.ts`
- Create: `src/db/jobs.ts`
- Modify: `src/db/index.ts`

**Step 1: Create jobs repository**

Create `src/db/jobs.ts`:
```typescript
import { supabase } from './client.js';

export interface Job {
  id: string;
  estimate_id: string | null;
  contact_id: string | null;
  description: string;
  stage: 'pending' | 'in_production' | 'ready' | 'installed' | 'completed';
  eta: string | null;
  total_amount: number | null;
  quickbooks_invoice_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateJobInput {
  estimateId: string;
  contactId: string | null;
  description: string;
  totalAmount: number | null;
}

export async function createJob(input: CreateJobInput): Promise<Job | null> {
  const { data, error } = await supabase
    .from('jobs')
    .insert({
      estimate_id: input.estimateId,
      contact_id: input.contactId,
      description: input.description,
      total_amount: input.totalAmount,
      stage: 'pending',
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to create job:', error);
    return null;
  }

  return data as Job;
}

export async function getJobById(id: string): Promise<Job | null> {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) return null;
  return data as Job;
}

export async function getActiveJobs(): Promise<Job[]> {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .neq('stage', 'completed')
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return data as Job[];
}

export async function updateJobStage(id: string, stage: Job['stage']): Promise<boolean> {
  const { error } = await supabase
    .from('jobs')
    .update({ stage, updated_at: new Date().toISOString() })
    .eq('id', id);

  return !error;
}

export async function updateJobEta(id: string, eta: string): Promise<boolean> {
  const { error } = await supabase
    .from('jobs')
    .update({ eta, updated_at: new Date().toISOString() })
    .eq('id', id);

  return !error;
}

export async function findJobByPrefix(prefix: string): Promise<Job | null> {
  const jobs = await getActiveJobs();
  return jobs.find(j => j.id.startsWith(prefix)) || null;
}
```

**Step 2: Update db/index.ts exports**

Add to `src/db/index.ts`:
```typescript
export {
  createJob,
  getJobById,
  getActiveJobs,
  updateJobStage,
  updateJobEta,
  findJobByPrefix,
  type Job,
} from './jobs.js';
```

**Step 3: Update /won command in callbacks.ts**

In `src/modules/telegram/callbacks.ts`, update the `setupOutcomeCommands` function's `/won` handler to also create a job:

Find and update the `/won` command section:
```typescript
  bot.command('won', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      await ctx.reply('Usage: /won <estimate_id_prefix>');
      return;
    }

    const idPrefix = args[1];
    const estimate = await findEstimateByPrefix(idPrefix);
    if (!estimate) {
      await ctx.reply(`❌ No estimate found starting with "${idPrefix}"`);
      return;
    }

    await updateEstimateStatus(estimate.id, 'won');
    if (estimate.quickbooks_estimate_id) {
      await updatePricingOutcome(estimate.quickbooks_estimate_id, 'won');
    }

    // Create job from won estimate
    const { createJob } = await import('../../db/index.js');
    const itemDescriptions = estimate.items.map(i => i.description).join(', ');
    const job = await createJob({
      estimateId: estimate.id,
      contactId: estimate.contact_id,
      description: itemDescriptions || 'No description',
      totalAmount: estimate.total_amount,
    });

    if (job) {
      await ctx.reply(
        `🎉 Estimate #${estimate.quickbooks_doc_number || estimate.id.slice(0, 8)} marked as WON!\n\n` +
        `📋 Job created: ${job.id.slice(0, 8)}\n` +
        `Use /stage ${job.id.slice(0, 8)} <stage> to update progress.`
      );
    } else {
      await ctx.reply(`🎉 Estimate marked as WON but failed to create job.`);
    }
  });
```

**Step 4: Verify build**

```bash
npm run build
```

**Step 5: Commit**

```bash
git add src/db/jobs.ts src/db/index.ts src/modules/telegram/callbacks.ts
git commit -m "feat: create job when estimate marked as won"
```

---

## Task 7: Add Telegram Job Commands

**Files:**
- Modify: `src/modules/telegram/callbacks.ts`

**Step 1: Add job commands to setupOutcomeCommands**

Add these commands in `src/modules/telegram/callbacks.ts` inside `setupOutcomeCommands()`:

```typescript
  // List active jobs
  bot.command('jobs', async (ctx) => {
    const { getActiveJobs } = await import('../../db/index.js');
    const jobs = await getActiveJobs();

    if (jobs.length === 0) {
      await ctx.reply('No active jobs.');
      return;
    }

    const list = jobs.map(job => {
      const eta = job.eta ? ` | ETA: ${job.eta}` : '';
      return `• ${job.id.slice(0, 8)} | ${job.stage}${eta}\n  ${job.description.slice(0, 50)}...`;
    }).join('\n\n');

    await ctx.reply(`📋 Active Jobs:\n\n${list}\n\nUse /job <id> for details.`);
  });

  // Show job details
  bot.command('job', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      await ctx.reply('Usage: /job <job_id_prefix>');
      return;
    }

    const { findJobByPrefix } = await import('../../db/index.js');
    const job = await findJobByPrefix(args[1]);
    if (!job) {
      await ctx.reply(`❌ No job found starting with "${args[1]}"`);
      return;
    }

    const eta = job.eta || 'Not set';
    const amount = job.total_amount ? `$${job.total_amount.toLocaleString()}` : 'N/A';

    await ctx.reply(
      `📋 Job: ${job.id.slice(0, 8)}\n\n` +
      `Stage: ${job.stage}\n` +
      `ETA: ${eta}\n` +
      `Amount: ${amount}\n\n` +
      `${job.description}\n\n` +
      `Commands:\n` +
      `/stage ${job.id.slice(0, 8)} <pending|in_production|ready|installed|completed>\n` +
      `/eta ${job.id.slice(0, 8)} <YYYY-MM-DD>`
    );
  });

  // Update job stage
  bot.command('stage', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 3) {
      await ctx.reply('Usage: /stage <job_id> <pending|in_production|ready|installed|completed>');
      return;
    }

    const validStages = ['pending', 'in_production', 'ready', 'installed', 'completed'];
    const stage = args[2].toLowerCase();
    if (!validStages.includes(stage)) {
      await ctx.reply(`Invalid stage. Use: ${validStages.join(', ')}`);
      return;
    }

    const { findJobByPrefix, updateJobStage } = await import('../../db/index.js');
    const job = await findJobByPrefix(args[1]);
    if (!job) {
      await ctx.reply(`❌ No job found starting with "${args[1]}"`);
      return;
    }

    const success = await updateJobStage(job.id, stage as any);
    if (success) {
      await ctx.reply(`✅ Job ${job.id.slice(0, 8)} updated to: ${stage}`);
    } else {
      await ctx.reply(`❌ Failed to update job stage.`);
    }
  });

  // Update job ETA
  bot.command('eta', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 3) {
      await ctx.reply('Usage: /eta <job_id> <YYYY-MM-DD>');
      return;
    }

    const dateStr = args[2];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      await ctx.reply('Invalid date format. Use: YYYY-MM-DD (e.g., 2026-01-25)');
      return;
    }

    const { findJobByPrefix, updateJobEta } = await import('../../db/index.js');
    const job = await findJobByPrefix(args[1]);
    if (!job) {
      await ctx.reply(`❌ No job found starting with "${args[1]}"`);
      return;
    }

    const success = await updateJobEta(job.id, dateStr);
    if (success) {
      await ctx.reply(`✅ Job ${job.id.slice(0, 8)} ETA set to: ${dateStr}`);
    } else {
      await ctx.reply(`❌ Failed to update job ETA.`);
    }
  });
```

**Step 2: Verify build**

```bash
npm run build
```

**Step 3: Test commands**

Run the backend and test:
- `/jobs` - should show empty or list
- `/job <id>` - show details
- `/stage <id> in_production` - update stage
- `/eta <id> 2026-01-25` - set ETA

**Step 4: Commit**

```bash
git add src/modules/telegram/callbacks.ts
git commit -m "feat: add Telegram commands for job management"
```

---

## Task 8: Create Login Page

**Files:**
- Create: `dashboard/app/login/page.tsx`
- Create: `dashboard/app/login/actions.ts`

**Step 1: Create login actions**

Create `dashboard/app/login/actions.ts`:
```typescript
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export async function login(formData: FormData) {
  const supabase = await createClient();

  const data = {
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  };

  const { error } = await supabase.auth.signInWithPassword(data);

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/', 'layout');
  redirect('/');
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
```

**Step 2: Create login page**

Create `dashboard/app/login/page.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { login } from './actions';

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    setError(null);
    const result = await login(formData);
    if (result?.error) {
      setError(result.error);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sedensia Dashboard</CardTitle>
          <CardDescription>Sign in to manage your jobs and estimates</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                placeholder="you@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
              />
            </div>
            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add dashboard/app/login/
git commit -m "feat: add login page with Supabase Auth"
```

---

## Task 9: Create Dashboard Layout

**Files:**
- Modify: `dashboard/app/layout.tsx`
- Create: `dashboard/components/nav.tsx`
- Modify: `dashboard/app/globals.css`

**Step 1: Create navigation component**

Create `dashboard/components/nav.tsx`:
```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { LayoutDashboard, Briefcase, FileText, Users, DollarSign, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { logout } from '@/app/login/actions';

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/jobs', label: 'Jobs', icon: Briefcase },
  { href: '/estimates', label: 'Estimates', icon: FileText },
  { href: '/contacts', label: 'Contacts', icon: Users },
  { href: '/pricing', label: 'Pricing', icon: DollarSign },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-slate-900 text-white min-h-screen p-4 flex flex-col">
      <div className="mb-8">
        <h1 className="text-xl font-bold">Sedensia</h1>
        <p className="text-slate-400 text-sm">Dashboard</p>
      </div>

      <nav className="flex-1 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href ||
            (item.href !== '/' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors',
                isActive
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <form action={logout}>
        <Button variant="ghost" className="w-full justify-start text-slate-400 hover:text-white">
          <LogOut className="h-5 w-5 mr-3" />
          Sign out
        </Button>
      </form>
    </aside>
  );
}
```

**Step 2: Update root layout**

Replace `dashboard/app/layout.tsx`:
```tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Nav } from '@/components/nav';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Sedensia Dashboard',
  description: 'Manage jobs, estimates, and pricing',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="flex min-h-screen">
          <Nav />
          <main className="flex-1 bg-slate-50 p-8">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
```

**Step 3: Create conditional layout for login**

Update `dashboard/app/login/page.tsx` to hide nav. Or better, create a route group.

Create `dashboard/app/(auth)/login/page.tsx` (move login there):
```
dashboard/app/
├── (auth)/
│   └── login/
│       ├── page.tsx
│       └── actions.ts
├── (dashboard)/
│   ├── layout.tsx      # Layout with nav
│   ├── page.tsx        # Home
│   ├── jobs/
│   ├── estimates/
│   ├── contacts/
│   └── pricing/
└── layout.tsx          # Root layout (minimal)
```

Actually, simpler approach - check auth in nav and conditionally render:

Update `dashboard/app/layout.tsx`:
```tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Sedensia Dashboard',
  description: 'Manage jobs, estimates, and pricing',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        {children}
      </body>
    </html>
  );
}
```

Create `dashboard/app/(dashboard)/layout.tsx`:
```tsx
import { Nav } from '@/components/nav';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <Nav />
      <main className="flex-1 bg-slate-50 p-8">
        {children}
      </main>
    </div>
  );
}
```

Move pages to `(dashboard)` folder.

**Step 4: Commit**

```bash
git add dashboard/app/ dashboard/components/nav.tsx
git commit -m "feat: add dashboard layout with navigation"
```

---

## Task 10: Create Dashboard Home Page

**Files:**
- Create: `dashboard/app/(dashboard)/page.tsx`
- Create: `dashboard/components/stats-cards.tsx`

**Step 1: Create stats cards component**

Create `dashboard/components/stats-cards.tsx`:
```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Briefcase, FileText, TrendingUp, DollarSign } from 'lucide-react';

interface StatsCardsProps {
  activeJobs: number;
  pendingEstimates: number;
  winRate: number;
  monthlyRevenue: number;
}

export function StatsCards({ activeJobs, pendingEstimates, winRate, monthlyRevenue }: StatsCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Active Jobs</CardTitle>
          <Briefcase className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{activeJobs}</div>
          <p className="text-xs text-muted-foreground">Currently in progress</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Pending Estimates</CardTitle>
          <FileText className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{pendingEstimates}</div>
          <p className="text-xs text-muted-foreground">Awaiting response</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{winRate}%</div>
          <p className="text-xs text-muted-foreground">Last 30 days</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Monthly Revenue</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">${monthlyRevenue.toLocaleString()}</div>
          <p className="text-xs text-muted-foreground">From won estimates</p>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 2: Create home page**

Create `dashboard/app/(dashboard)/page.tsx`:
```tsx
import { createClient } from '@/lib/supabase/server';
import { StatsCards } from '@/components/stats-cards';

async function getStats() {
  const supabase = await createClient();

  // Active jobs count
  const { count: activeJobs } = await supabase
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .neq('stage', 'completed');

  // Pending estimates count
  const { count: pendingEstimates } = await supabase
    .from('estimates')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'sent');

  // Win rate (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: recentEstimates } = await supabase
    .from('estimates')
    .select('status')
    .gte('created_at', thirtyDaysAgo.toISOString())
    .in('status', ['won', 'lost']);

  const won = recentEstimates?.filter(e => e.status === 'won').length || 0;
  const total = recentEstimates?.length || 0;
  const winRate = total > 0 ? Math.round((won / total) * 100) : 0;

  // Monthly revenue
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { data: wonEstimates } = await supabase
    .from('estimates')
    .select('total_amount')
    .eq('status', 'won')
    .gte('updated_at', startOfMonth.toISOString());

  const monthlyRevenue = wonEstimates?.reduce((sum, e) => sum + (e.total_amount || 0), 0) || 0;

  return {
    activeJobs: activeJobs || 0,
    pendingEstimates: pendingEstimates || 0,
    winRate,
    monthlyRevenue,
  };
}

export default async function DashboardPage() {
  const stats = await getStats();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your business</p>
      </div>

      <StatsCards {...stats} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white rounded-lg p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-4">Recent Activity</h2>
          <p className="text-muted-foreground">Coming soon...</p>
        </div>

        <div className="bg-white rounded-lg p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
          <p className="text-muted-foreground">Coming soon...</p>
        </div>
      </div>
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add dashboard/app/ dashboard/components/
git commit -m "feat: add dashboard home page with stats"
```

---

## Task 11: Create Jobs List Page

**Files:**
- Create: `dashboard/app/(dashboard)/jobs/page.tsx`
- Create: `dashboard/components/jobs-table.tsx`

**Step 1: Create jobs table component**

Create `dashboard/components/jobs-table.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import type { JobWithContact } from '@/lib/database.types';
import { updateJobStage, updateJobEta } from '@/app/(dashboard)/jobs/actions';

const stageColors: Record<string, string> = {
  pending: 'bg-slate-500',
  in_production: 'bg-blue-500',
  ready: 'bg-green-500',
  installed: 'bg-purple-500',
  completed: 'bg-gray-400',
};

const stageLabels: Record<string, string> = {
  pending: 'Pending',
  in_production: 'In Production',
  ready: 'Ready',
  installed: 'Installed',
  completed: 'Completed',
};

interface JobsTableProps {
  jobs: JobWithContact[];
}

export function JobsTable({ jobs }: JobsTableProps) {
  const [editingEta, setEditingEta] = useState<string | null>(null);
  const [etaValue, setEtaValue] = useState('');

  async function handleStageChange(jobId: string, stage: string) {
    await updateJobStage(jobId, stage);
  }

  async function handleEtaSave(jobId: string) {
    if (etaValue) {
      await updateJobEta(jobId, etaValue);
    }
    setEditingEta(null);
    setEtaValue('');
  }

  return (
    <div className="bg-white rounded-lg shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>ETA</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => (
            <TableRow key={job.id}>
              <TableCell>
                <div>
                  <div className="font-medium">{job.contact?.name || 'Unknown'}</div>
                  <div className="text-sm text-muted-foreground">
                    {job.contact?.company || ''}
                  </div>
                </div>
              </TableCell>
              <TableCell className="max-w-xs truncate">
                {job.description}
              </TableCell>
              <TableCell>
                <Select
                  value={job.stage}
                  onValueChange={(value) => handleStageChange(job.id, value)}
                >
                  <SelectTrigger className="w-36">
                    <Badge className={stageColors[job.stage]}>
                      {stageLabels[job.stage]}
                    </Badge>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(stageLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                {editingEta === job.id ? (
                  <div className="flex gap-2">
                    <Input
                      type="date"
                      value={etaValue}
                      onChange={(e) => setEtaValue(e.target.value)}
                      className="w-36"
                    />
                    <Button size="sm" onClick={() => handleEtaSave(job.id)}>
                      Save
                    </Button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setEditingEta(job.id);
                      setEtaValue(job.eta || '');
                    }}
                    className="text-left hover:underline"
                  >
                    {job.eta ? format(new Date(job.eta), 'MMM d, yyyy') : 'Set ETA'}
                  </button>
                )}
              </TableCell>
              <TableCell className="text-right">
                {job.total_amount
                  ? `$${job.total_amount.toLocaleString()}`
                  : '-'}
              </TableCell>
            </TableRow>
          ))}
          {jobs.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                No jobs found
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
```

**Step 2: Create jobs actions**

Create `dashboard/app/(dashboard)/jobs/actions.ts`:
```typescript
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export async function updateJobStage(jobId: string, stage: string) {
  const supabase = await createClient();

  await supabase
    .from('jobs')
    .update({ stage, updated_at: new Date().toISOString() })
    .eq('id', jobId);

  revalidatePath('/jobs');
}

export async function updateJobEta(jobId: string, eta: string) {
  const supabase = await createClient();

  await supabase
    .from('jobs')
    .update({ eta, updated_at: new Date().toISOString() })
    .eq('id', jobId);

  revalidatePath('/jobs');
}
```

**Step 3: Create jobs page**

Create `dashboard/app/(dashboard)/jobs/page.tsx`:
```tsx
import { createClient } from '@/lib/supabase/server';
import { JobsTable } from '@/components/jobs-table';
import type { JobWithContact } from '@/lib/database.types';

async function getJobs(): Promise<JobWithContact[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('jobs')
    .select(`
      *,
      contact:contacts(*),
      estimate:estimates(*)
    `)
    .neq('stage', 'completed')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to fetch jobs:', error);
    return [];
  }

  return data as JobWithContact[];
}

export default async function JobsPage() {
  const jobs = await getJobs();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Jobs</h1>
        <p className="text-muted-foreground">Manage active jobs and track progress</p>
      </div>

      <JobsTable jobs={jobs} />
    </div>
  );
}
```

**Step 4: Commit**

```bash
git add dashboard/app/ dashboard/components/
git commit -m "feat: add jobs list page with inline editing"
```

---

## Task 12: Create Estimates List Page

**Files:**
- Create: `dashboard/app/(dashboard)/estimates/page.tsx`
- Create: `dashboard/components/estimates-table.tsx`

**Step 1: Create estimates table component**

Create `dashboard/components/estimates-table.tsx`:
```tsx
import { format } from 'date-fns';
import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type { EstimateWithContact } from '@/lib/database.types';

const statusColors: Record<string, string> = {
  draft: 'bg-slate-500',
  sent: 'bg-blue-500',
  won: 'bg-green-500',
  lost: 'bg-red-500',
  expired: 'bg-gray-400',
};

interface EstimatesTableProps {
  estimates: EstimateWithContact[];
}

export function EstimatesTable({ estimates }: EstimatesTableProps) {
  return (
    <div className="bg-white rounded-lg shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Items</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {estimates.map((estimate) => (
            <TableRow key={estimate.id}>
              <TableCell>
                <Link
                  href={`/estimates/${estimate.id}`}
                  className="hover:underline"
                >
                  <div className="font-medium">
                    {estimate.contact?.name || 'Unknown'}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {estimate.contact?.company || ''}
                  </div>
                </Link>
              </TableCell>
              <TableCell>
                {format(new Date(estimate.created_at), 'MMM d, yyyy')}
              </TableCell>
              <TableCell>
                <Badge className={statusColors[estimate.status]}>
                  {estimate.status.charAt(0).toUpperCase() + estimate.status.slice(1)}
                </Badge>
              </TableCell>
              <TableCell>
                {estimate.items?.length || 0} items
              </TableCell>
              <TableCell className="text-right">
                {estimate.total_amount
                  ? `$${estimate.total_amount.toLocaleString()}`
                  : '-'}
              </TableCell>
            </TableRow>
          ))}
          {estimates.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                No estimates found
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
```

**Step 2: Create estimates page**

Create `dashboard/app/(dashboard)/estimates/page.tsx`:
```tsx
import { createClient } from '@/lib/supabase/server';
import { EstimatesTable } from '@/components/estimates-table';
import type { EstimateWithContact } from '@/lib/database.types';

async function getEstimates(): Promise<EstimateWithContact[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('estimates')
    .select(`
      *,
      contact:contacts(*)
    `)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Failed to fetch estimates:', error);
    return [];
  }

  return data as EstimateWithContact[];
}

export default async function EstimatesPage() {
  const estimates = await getEstimates();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Estimates</h1>
        <p className="text-muted-foreground">View and track all estimates</p>
      </div>

      <EstimatesTable estimates={estimates} />
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add dashboard/app/ dashboard/components/
git commit -m "feat: add estimates list page"
```

---

## Task 13: Create Contacts Page

**Files:**
- Create: `dashboard/app/(dashboard)/contacts/page.tsx`
- Create: `dashboard/app/(dashboard)/contacts/actions.ts`
- Create: `dashboard/components/contacts-table.tsx`

**Step 1: Create contacts actions**

Create `dashboard/app/(dashboard)/contacts/actions.ts`:
```typescript
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export async function addContact(formData: FormData) {
  const supabase = await createClient();

  const { error } = await supabase.from('contacts').insert({
    name: formData.get('name') as string,
    email: formData.get('email') as string,
    company: formData.get('company') as string || null,
    is_active: true,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/contacts');
  return { success: true };
}

export async function toggleContactActive(contactId: string, isActive: boolean) {
  const supabase = await createClient();

  await supabase
    .from('contacts')
    .update({ is_active: isActive })
    .eq('id', contactId);

  revalidatePath('/contacts');
}
```

**Step 2: Create contacts table component**

Create `dashboard/components/contacts-table.tsx`:
```tsx
'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import type { Contact } from '@/lib/database.types';
import { toggleContactActive } from '@/app/(dashboard)/contacts/actions';

interface ContactsTableProps {
  contacts: Contact[];
}

export function ContactsTable({ contacts }: ContactsTableProps) {
  async function handleToggle(contactId: string, currentValue: boolean) {
    await toggleContactActive(contactId, !currentValue);
  }

  return (
    <div className="bg-white rounded-lg shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Active</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contacts.map((contact) => (
            <TableRow key={contact.id}>
              <TableCell className="font-medium">{contact.name}</TableCell>
              <TableCell>{contact.company || '-'}</TableCell>
              <TableCell>{contact.email}</TableCell>
              <TableCell>
                <Switch
                  checked={contact.is_active}
                  onCheckedChange={() => handleToggle(contact.id, contact.is_active)}
                />
              </TableCell>
            </TableRow>
          ))}
          {contacts.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                No contacts found
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
```

**Step 3: Create contacts page**

Create `dashboard/app/(dashboard)/contacts/page.tsx`:
```tsx
import { createClient } from '@/lib/supabase/server';
import { ContactsTable } from '@/components/contacts-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Plus } from 'lucide-react';
import { addContact } from './actions';
import type { Contact } from '@/lib/database.types';

async function getContacts(): Promise<Contact[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .order('name');

  if (error) {
    console.error('Failed to fetch contacts:', error);
    return [];
  }

  return data as Contact[];
}

export default async function ContactsPage() {
  const contacts = await getContacts();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Contacts</h1>
          <p className="text-muted-foreground">Manage monitored email contacts</p>
        </div>

        <Dialog>
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
            <form action={addContact} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="company">Company</Label>
                <Input id="company" name="company" />
              </div>
              <Button type="submit" className="w-full">Add Contact</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <ContactsTable contacts={contacts} />
    </div>
  );
}
```

**Step 4: Add Switch component**

```bash
cd dashboard && npx shadcn@latest add switch
```

**Step 5: Commit**

```bash
git add dashboard/
git commit -m "feat: add contacts page with add/toggle functionality"
```

---

## Task 14: Create Pricing Page

**Files:**
- Create: `dashboard/app/(dashboard)/pricing/page.tsx`

**Step 1: Create pricing page**

Create `dashboard/app/(dashboard)/pricing/page.tsx`:
```tsx
import { createClient } from '@/lib/supabase/server';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

async function getPricingData() {
  const supabase = await createClient();

  // Get pricing history
  const { data: history } = await supabase
    .from('pricing_history')
    .select(`
      *,
      sign_type:sign_types(name),
      material:materials(name)
    `)
    .order('created_at', { ascending: false })
    .limit(50);

  // Get win rate by sign type
  const { data: signTypes } = await supabase
    .from('sign_types')
    .select('id, name');

  const winRates: Record<string, { wins: number; total: number }> = {};

  if (signTypes) {
    for (const st of signTypes) {
      const { data } = await supabase
        .from('pricing_history')
        .select('outcome')
        .eq('sign_type_id', st.id)
        .in('outcome', ['won', 'lost']);

      if (data && data.length > 0) {
        const wins = data.filter(d => d.outcome === 'won').length;
        winRates[st.name] = { wins, total: data.length };
      }
    }
  }

  return { history: history || [], winRates };
}

export default async function PricingPage() {
  const { history, winRates } = await getPricingData();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Pricing Analytics</h1>
        <p className="text-muted-foreground">Historical pricing and win rates</p>
      </div>

      {/* Win Rates by Sign Type */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Object.entries(winRates).map(([signType, { wins, total }]) => (
          <Card key={signType}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{signType}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {Math.round((wins / total) * 100)}%
              </div>
              <p className="text-xs text-muted-foreground">
                {wins} won / {total} total
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pricing History Table */}
      <div className="bg-white rounded-lg shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead>Sign Type</TableHead>
              <TableHead>Material</TableHead>
              <TableHead>Size</TableHead>
              <TableHead className="text-right">Unit Price</TableHead>
              <TableHead>Outcome</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.map((item: any) => (
              <TableRow key={item.id}>
                <TableCell className="max-w-xs truncate">
                  {item.description || '-'}
                </TableCell>
                <TableCell>{item.sign_type?.name || '-'}</TableCell>
                <TableCell>{item.material?.name || '-'}</TableCell>
                <TableCell>
                  {item.width_inches && item.height_inches
                    ? `${item.width_inches}"×${item.height_inches}"`
                    : '-'}
                </TableCell>
                <TableCell className="text-right">
                  ${item.unit_price?.toLocaleString() || '-'}
                </TableCell>
                <TableCell>
                  <Badge
                    className={
                      item.outcome === 'won'
                        ? 'bg-green-500'
                        : item.outcome === 'lost'
                        ? 'bg-red-500'
                        : 'bg-slate-500'
                    }
                  >
                    {item.outcome}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add dashboard/app/
git commit -m "feat: add pricing analytics page"
```

---

## Task 15: Add Netlify Configuration

**Files:**
- Create: `netlify.toml`
- Update: `.gitignore`

**Step 1: Create netlify.toml**

Create `netlify.toml` in repo root:
```toml
[build]
  base = "dashboard"
  command = "npm run build"
  publish = ".next"

[[plugins]]
  package = "@netlify/plugin-nextjs"

[build.environment]
  NODE_VERSION = "20"
```

**Step 2: Update .gitignore**

Add to `.gitignore`:
```
# Dashboard
dashboard/.next/
dashboard/node_modules/
dashboard/.env.local
```

**Step 3: Commit**

```bash
git add netlify.toml .gitignore
git commit -m "feat: add Netlify deployment configuration"
```

---

## Task 16: Create Admin User in Supabase

**Step 1: Enable Email Auth in Supabase**

Go to Supabase Dashboard → Authentication → Providers → Email → Enable

**Step 2: Create admin user via SQL**

Use Supabase MCP or SQL editor:
```sql
-- Create admin user (replace with your email)
INSERT INTO auth.users (
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at
) VALUES (
  'admin@sedensia.com',
  crypt('your-secure-password', gen_salt('bf')),
  NOW(),
  NOW(),
  NOW()
);
```

Or use Supabase Dashboard → Authentication → Users → Add User

**Step 3: Test login**

Start dashboard locally and test login with the admin credentials.

---

## Task 17: Add RLS Policies

**Files:**
- Create: `supabase/migrations/005_rls_policies.sql`

**Step 1: Create RLS policies migration**

Create `supabase/migrations/005_rls_policies.sql`:
```sql
-- Enable RLS on all tables
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sign_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_history ENABLE ROW LEVEL SECURITY;

-- Policies for authenticated users (allow all for now, single-tenant)
CREATE POLICY "Authenticated users can read contacts" ON contacts
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert contacts" ON contacts
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update contacts" ON contacts
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read estimates" ON estimates
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read jobs" ON jobs
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can update jobs" ON jobs
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read sign_types" ON sign_types
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read materials" ON materials
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read pricing_history" ON pricing_history
  FOR SELECT TO authenticated USING (true);

-- Service role bypasses RLS for backend operations
```

**Step 2: Apply migration via Supabase MCP**

**Step 3: Commit**

```bash
git add supabase/migrations/005_rls_policies.sql
git commit -m "feat: add RLS policies for dashboard security"
```

---

## Task 18: Final Testing & Tag

**Step 1: Run backend tests**

```bash
npm test
```

Expected: All tests pass

**Step 2: Run dashboard build**

```bash
cd dashboard && npm run build
```

Expected: Build succeeds

**Step 3: Test locally**

1. Start backend: `npm run dev`
2. Start dashboard: `cd dashboard && npm run dev`
3. Test login at http://localhost:3001/login
4. Verify all pages load with data

**Step 4: Create tag**

```bash
git add -A
git commit -m "feat: complete Phase 3 dashboard UI"
git tag -a v0.3.0 -m "Phase 3: Dashboard UI with jobs, estimates, contacts, pricing"
```

**Step 5: Push**

```bash
git push origin main --tags
```

---

## Success Criteria

Phase 3 is complete when:

- [ ] Next.js app created in `dashboard/` folder
- [ ] Supabase Auth working with login page
- [ ] Jobs table created and auto-populated from `/won`
- [ ] Telegram commands work (`/jobs`, `/job`, `/stage`, `/eta`)
- [ ] Dashboard home shows stats
- [ ] Jobs page with inline stage/ETA editing
- [ ] Estimates page showing all estimates
- [ ] Contacts page with add/toggle
- [ ] Pricing page with analytics
- [ ] Netlify config ready for deployment
- [ ] RLS policies protecting data
- [ ] All tests pass
