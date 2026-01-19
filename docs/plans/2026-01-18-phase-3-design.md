# Phase 3: Dashboard UI - Design Document

**Status:** Implemented ✅

## Overview

Phase 3 adds a Next.js dashboard for full visibility into jobs, estimates, contacts, and pricing history.

**Goal:** Get visibility into all data before adding automation (Phase 4).

**Tech Stack:**
- Next.js 14 (App Router)
- Supabase (same database as backend)
- Tailwind CSS + shadcn/ui
- Netlify deployment
- Domain: subdomain of sedensia.com

## Pages

```
/                → Dashboard home (summary stats + activity)
/jobs            → Active jobs with stage + ETA
/jobs/[id]       → Job detail page
/estimates       → All estimates (draft, sent, won, lost)
/estimates/[id]  → Estimate detail with line items
/contacts        → Contact list with activity
/pricing         → Pricing history + win rate analytics
```

## Data Model

### New `jobs` Table

```sql
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

CREATE INDEX idx_jobs_stage ON jobs(stage);
CREATE INDEX idx_jobs_contact ON jobs(contact_id);
CREATE INDEX idx_jobs_estimate ON jobs(estimate_id);
```

### Job Stages

| Stage | Description |
|-------|-------------|
| `pending` | Won but not started |
| `in_production` | Being fabricated |
| `ready` | Ready for pickup/install |
| `installed` | Installed at customer site |
| `completed` | Done, archived |

### Job Creation

Jobs are auto-created when an estimate is marked as won via the `/won` Telegram command:
- Copies contact, description, amount from estimate
- Links back to original estimate
- Starts in `pending` stage with no ETA

## Project Structure

```
sedensia-assistant/          # Existing repo (monorepo)
├── src/                     # Fastify backend (unchanged)
├── dashboard/               # New Next.js app
│   ├── app/
│   ├── components/
│   ├── lib/
│   └── package.json
├── supabase/
├── docs/
├── netlify.toml             # Dashboard deploy config
└── package.json             # Root (backend)
```

## Dashboard Structure

```
dashboard/
├── app/
│   ├── layout.tsx           # Root layout with nav
│   ├── page.tsx             # Dashboard home
│   ├── jobs/
│   │   ├── page.tsx         # Jobs list
│   │   └── [id]/page.tsx    # Job detail
│   ├── estimates/
│   │   ├── page.tsx         # Estimates list
│   │   └── [id]/page.tsx    # Estimate detail
│   ├── contacts/
│   │   └── page.tsx         # Contacts list
│   └── pricing/
│       └── page.tsx         # Pricing analytics
├── components/
│   ├── ui/                  # shadcn components
│   ├── nav.tsx              # Navigation sidebar
│   ├── jobs-table.tsx
│   ├── estimates-table.tsx
│   ├── contacts-table.tsx
│   └── stats-cards.tsx
├── lib/
│   ├── supabase/
│   │   ├── client.ts        # Browser client
│   │   └── server.ts        # Server client
│   └── utils.ts
└── .env.local
```

## Page Details

### Dashboard Home (`/`)

**Stats Cards:**
- Active jobs count
- Pending estimates count
- Win rate (last 30 days)
- Revenue this month

**Recent Activity:**
- New estimate requests
- Status changes
- Won/lost outcomes

### Jobs (`/jobs`)

**Table Columns:**
- Customer (name + company)
- Description (truncated)
- Stage (badge)
- ETA (date or "Not set")
- Amount

**Features:**
- Filter by stage
- Sort by date, ETA, amount
- Click row → detail page
- Inline edit for stage + ETA

### Job Detail (`/jobs/[id]`)

- Full job info
- Link to original estimate
- Stage + ETA editing
- Notes field
- Activity timeline

### Estimates (`/estimates`)

**Table Columns:**
- Customer
- Date created
- Status (badge: draft, sent, won, lost)
- Total amount
- Items count

**Features:**
- Filter by status
- Sort by date, amount
- Click row → detail page

### Estimate Detail (`/estimates/[id]`)

- Customer info
- Line items with pricing
- Confidence levels shown
- QuickBooks link (if synced)
- Status history

### Contacts (`/contacts`)

**Table Columns:**
- Name
- Company
- Email
- Active (toggle)
- Last activity

**Features:**
- Add new contact
- Edit inline
- Toggle active/inactive
- View related estimates

### Pricing (`/pricing`)

**Charts:**
- Win rate by sign type (bar chart)
- Average price per sqft by category

**Table:**
- Recent pricing history
- Filter by sign type, material
- Outcome indicators

## Authentication

- Supabase Auth with email/password
- Single admin user initially
- RLS policies protect all tables
- Session-based auth with middleware

## Deployment

### Dashboard (Netlify)

**netlify.toml** (root of repo):
```toml
[build]
  base = "dashboard"
  command = "npm run build"
  publish = ".next"

[[plugins]]
  package = "@netlify/plugin-nextjs"
```

**Environment Variables (Netlify):**
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (for server actions)

**Domain:** app.sedensia.com

### Backend (Separate)

Backend stays deployed wherever it runs now (Railway, Render, VPS, etc.).
Uses ngrok for local development with webhooks.

## Backend Changes

### Update `/won` Command

When estimate is marked as won:
1. Update estimate status to 'won'
2. Create new job record
3. Copy contact, description, amount
4. Notify via Telegram with job ID

### New Telegram Commands

- `/jobs` - List active jobs (non-completed)
- `/job <id>` - Show job details
- `/stage <id> <stage>` - Update job stage
- `/eta <id> <date>` - Set job ETA

## Success Criteria

Phase 3 is complete when:
- [x] Next.js app deployed to Netlify
- [x] Supabase Auth working
- [x] Jobs table created and auto-populated from `/won`
- [x] All pages functional (jobs, estimates, contacts, pricing)
- [x] Inline editing works for jobs
- [x] Telegram commands for job management work
- [x] RLS policies protect data

## Future (Phase 4) - COMPLETE

- Smart intent handling (status inquiries, reorders)
- Auto-reply drafts with approval
- Job matching by description
- Email sending from app
