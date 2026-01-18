# Sedensia Business Assistant - Design Document

**Date:** 2026-01-18
**Status:** Approved
**Author:** Patrick Jeong + Claude

## Overview

Sedensia Assistant automates the estimate-to-invoice workflow for Sedensia Signs, a sign fabrication business serving Samsung Taylor. The assistant monitors email for estimate requests, drafts estimates using AI and historical pricing data, manages job status, and handles invoicing upon delivery.

### Primary Contact
- **Client:** Samsung Taylor
- **Contact:** Minseok Kim (minseoks.kim@samsung.com)
- Configurable via database for future expansion

### Core Capabilities
1. Monitor Gmail inbox for messages from configured contacts
2. Parse estimate requests using AI (sign types, quantities, sizes, special requests)
3. Draft estimates based on pricing history and bid success rates
4. Calculate turnaround time based on current workload
5. Send estimates via QuickBooks after Telegram approval
6. Track job status through fabrication and delivery
7. Convert estimates to invoices and send completion emails
8. Log all data for pricing optimization

## Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Runtime | Node.js 20+ / TypeScript | Async-native, strong ecosystem |
| Framework | Fastify | Lightweight, fast webhook handling |
| Telegram | Telegraf | Mature bot framework, good TypeScript support |
| Database | Supabase (PostgreSQL) | Managed, real-time subscriptions, easy setup |
| Email | Gmail API + Cloud Pub/Sub | Real-time push notifications |
| Invoicing | QuickBooks Online API | Official SDK, estimate/invoice management |
| AI | Anthropic Claude API | Excellent extraction and professional writing |
| Hosting | Railway or DigitalOcean | Simple VPS, always-on for bot responsiveness |

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Sedensia Assistant                       │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Gmail Module │  │ Telegram Bot │  │ QuickBooks Client│  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                 │                   │             │
│         ▼                 ▼                   ▼             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              AI Engine (Claude API)                     ││
│  │  • Email parsing & intent detection                     ││
│  │  • Estimate drafting & pricing recommendations          ││
│  │  • Response generation                                  ││
│  └─────────────────────────────────────────────────────────┘│
│         │                 │                   │             │
│         ▼                 ▼                   ▼             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              Supabase (PostgreSQL)                      ││
│  │  • Jobs, estimates, invoices                            ││
│  │  • Pricing history & bid success rates                  ││
│  │  • Contact configuration                                ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## Database Schema

### `contacts`
Configurable client contacts to monitor.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| name | text | Contact name |
| email | text | Email address to monitor |
| company | text | Company name |
| is_active | boolean | Whether to monitor this contact |
| created_at | timestamptz | Record creation time |

### `jobs`
Central record for each project.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| contact_id | uuid | FK to contacts |
| status | enum | `requested`, `estimated`, `approved`, `in_progress`, `fabricating`, `delivered`, `invoiced`, `paid` |
| gmail_thread_id | text | Original email thread for replies |
| gmail_message_id | text | Specific message ID |
| subject | text | Email subject line |
| request_summary | text | AI-generated summary |
| requested_at | timestamptz | When request was received |
| estimated_at | timestamptz | When estimate was sent |
| approved_at | timestamptz | When customer approved |
| completed_at | timestamptz | When delivered |
| created_at | timestamptz | Record creation time |

### `job_items`
Individual line items per job.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| job_id | uuid | FK to jobs |
| sign_type | text | Type of sign |
| description | text | Detailed description |
| quantity | integer | Number of units |
| size | text | Dimensions |
| unit_price | decimal | Price per unit |
| total_price | decimal | Quantity × unit price |
| special_requests | text | Custom notes from request |

### `estimates`
Estimate records linked to jobs.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| job_id | uuid | FK to jobs |
| quickbooks_estimate_id | text | QuickBooks reference |
| subtotal | decimal | Before tax |
| tax | decimal | Tax amount |
| total | decimal | Final total |
| turnaround_days | integer | Estimated business days |
| pdf_url | text | Stored PDF location |
| created_at | timestamptz | When drafted |
| sent_at | timestamptz | When sent to customer |
| approved_at | timestamptz | When customer approved |

### `invoices`
Invoice records after job completion.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| job_id | uuid | FK to jobs |
| estimate_id | uuid | FK to estimates |
| quickbooks_invoice_id | text | QuickBooks reference |
| total | decimal | Invoice total |
| pdf_url | text | Stored PDF location |
| sent_at | timestamptz | When sent |
| paid_at | timestamptz | When payment received |

### `pricing_history`
Historical pricing for AI recommendations.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| sign_type | text | Type of sign |
| size_category | text | Size grouping |
| unit_price | decimal | Price charged |
| job_id | uuid | FK to jobs |
| bid_won | boolean | Whether this price won |
| created_at | timestamptz | Record creation time |

## Phase 1: Email Monitoring & Telegram Notifications

### Goal
Detect estimate requests from Samsung and notify via Telegram with a structured summary.

### Email Monitoring Flow

```
Gmail Inbox
    │
    ▼ (Pub/Sub push notification)
┌─────────────────────────────────┐
│  Webhook Endpoint               │
│  POST /webhooks/gmail           │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  Email Processor                │
│  1. Fetch full message via API  │
│  2. Check sender against        │
│     contacts table              │
│  3. If match → process          │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  AI Parser (Claude)             │
│  Extract:                       │
│  • Intent (new request/update/  │
│    reorder)                     │
│  • Sign types & quantities      │
│  • Sizes                        │
│  • Special requests             │
│  • Urgency indicators           │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  Telegram Notification          │
│  Format & send summary          │
└─────────────────────────────────┘
```

### Telegram Message Format

```
📬 New Estimate Request from Samsung

From: Minseok Kim
Subject: Channel Letters for Taylor Facility

Signs Requested:
• Channel Letters (illuminated) - 12 pcs - 24"x18"
• Directional Signs - 8 pcs - 12"x8"

Special Requests:
• Samsung blue (PMS 2945C) required
• Need by end of February

[View Email] [Create Estimate]
```

### Implementation Tasks
- [ ] Project setup (TypeScript, Fastify, environment config)
- [ ] Supabase schema: `contacts` table
- [ ] Gmail API OAuth setup + Pub/Sub webhook
- [ ] Telegram bot basic setup
- [ ] Claude integration for email parsing
- [ ] End-to-end: email received → parsed → Telegram notification

## Phase 2: Estimate Workflow

### Goal
AI-assisted estimate drafting with Telegram-based approval.

### Estimate Flow

```
Telegram: [Create Estimate] tapped
    │
    ▼
┌─────────────────────────────────┐
│  Pricing Engine                 │
│  1. Query pricing_history for   │
│     similar sign types/sizes    │
│  2. Calculate bid success rate  │
│     per price point             │
│  3. AI recommends pricing with  │
│     confidence score            │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  Turnaround Calculator          │
│  1. Query active jobs by status │
│  2. Sum current workload        │
│  3. Estimate days based on      │
│     job size + backlog          │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  QuickBooks API                 │
│  Create draft estimate          │
│  (not yet sent to customer)     │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  Telegram Review Message        │
└─────────────────────────────────┘
```

### Telegram Review Format

```
📋 Draft Estimate #1042

Channel Letters (24"x18") × 12 ... $3,600
Directional Signs (12"x8") × 8 ... $960
─────────────────────────────
Subtotal: $4,560
Tax: $376.20
Total: $4,936.20

⏱ Turnaround: 14 business days
   (Based on 3 active jobs)

Pricing notes:
• Channel letters: $300/ea matches last
  3 winning bids for this size
• Directional: Slightly below avg ($125)
  to stay competitive

[✓ Approve & Send] [✎ Edit] [✗ Decline]
```

### Implementation Tasks
- [ ] Supabase schema: `jobs`, `job_items`, `estimates`, `pricing_history`
- [ ] QuickBooks OAuth setup
- [ ] Pricing recommendation engine
- [ ] Turnaround calculator
- [ ] Telegram inline buttons for approval
- [ ] Estimate creation → approval → send flow

## Phase 3: Status & Communication

### Goal
Handle status inquiries, reorder requests, and job tracking.

### Intent Detection

| Intent | Example | Action |
|--------|---------|--------|
| `new_request` | "Can you quote 10 monument signs?" | → Phase 1 flow |
| `status_inquiry` | "What's the status on the channel letters?" | → Lookup & reply |
| `reorder` | "Can we get the same wayfinding signs from last month?" | → Pull previous job, confirm pricing |
| `approval` | "Approved, please proceed" | → Update job to `approved` |
| `general` | "Thanks!" / scheduling chat | → Notify you, no auto-action |

### Status Inquiry Flow

```
Email: "What's the status on the channel letters?"
    │
    ▼
┌─────────────────────────────────┐
│  AI Intent Detection            │
│  Intent: status_inquiry         │
│  Extracted: "channel letters"   │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  Job Matcher                    │
│  Query recent jobs by contact   │
│  + fuzzy match on description   │
│  Found: Job #1042               │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  Telegram Notification          │
└─────────────────────────────────┘
```

### Telegram Status Format

```
❓ Status Inquiry from Minseok

Re: Channel Letters (Job #1042)

Current Status: Fabricating
Started: Jan 15 → Est. Complete: Jan 24

[Reply with Update] [Mark Delivered]
```

### Telegram Commands
- `/status <job_id> <status>` - Update job status
- `/jobs` - List active jobs with statuses

### Implementation Tasks
- [ ] Intent detection for incoming emails
- [ ] Job matching by description
- [ ] Status inquiry auto-response (with approval)
- [ ] Reorder detection and pricing lookup
- [ ] Telegram commands (`/status`, `/jobs`)

## Phase 4: Invoicing & Job Completion

### Goal
Convert estimates to invoices, send completion emails, track payment.

### Completion Flow

```
Telegram: [Mark Delivered] tapped
    │
    ▼
┌─────────────────────────────────┐
│  Delivery Confirmation          │
│  Prompt: "Confirm delivery?"    │
│  Optional: Add delivery notes   │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  QuickBooks API                 │
│  1. Convert estimate → invoice  │
│  2. Download invoice PDF        │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  AI Email Composer              │
│  Draft completion email with:   │
│  • Project summary              │
│  • Delivery confirmation        │
│  • Invoice attached             │
│  • Thank you note               │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  Gmail API                      │
│  Reply to original thread       │
│  (maintains conversation)       │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  Database Update                │
│  Status → invoiced              │
│  Record pricing for history     │
└─────────────────────────────────┘
```

### Completion Email Example

```
Subject: Re: Channel Letters for Taylor Facility

Hi Minseok,

The channel letters for the Taylor facility have been
delivered and installed as of January 24th.

Project Summary:
• 12× Illuminated Channel Letters (24"×18")
• 8× Directional Signs (12"×8")

Please find the invoice attached. Payment terms are
Net 30 as agreed.

Thank you for your continued partnership. Let us know
if you need anything else.

Best regards,
Sedensia Signs

[Invoice-1042.pdf attached]
```

### Telegram Confirmation

```
✅ Job #1042 Complete

Invoice #INV-1042 sent to Minseok Kim
Amount: $4,936.20
Thread: Re: Channel Letters for Taylor Facility

[View Invoice] [Mark Paid]
```

### Implementation Tasks
- [ ] Estimate → Invoice conversion in QuickBooks
- [ ] PDF download and storage
- [ ] Completion email composer (AI)
- [ ] Gmail thread reply with attachment
- [ ] Payment tracking (`/paid <job_id>`)

## External Service Setup Requirements

### Google Cloud (Gmail API)
1. Create Google Cloud project
2. Enable Gmail API
3. Configure OAuth consent screen
4. Create OAuth 2.0 credentials
5. Set up Pub/Sub topic and subscription
6. Configure push notifications to webhook endpoint

### Telegram Bot
1. Create bot via @BotFather
2. Get bot token
3. Set webhook URL (production) or use polling (development)

### QuickBooks Online
1. Create Intuit Developer account
2. Create app in developer portal
3. Configure OAuth 2.0 redirect URIs
4. Get client ID and secret
5. Implement token refresh flow (tokens expire)

### Supabase
1. Create Supabase project
2. Run migration scripts for schema
3. Configure Row Level Security (RLS) policies
4. Get project URL and anon key

### Anthropic Claude
1. Create Anthropic account
2. Generate API key
3. Set usage limits/alerts

## Environment Variables

```bash
# Server
PORT=3000
NODE_ENV=production

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx

# Gmail
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REDIRECT_URI=xxx
GMAIL_PUBSUB_TOPIC=projects/xxx/topics/gmail-notifications

# Telegram
TELEGRAM_BOT_TOKEN=xxx
TELEGRAM_ADMIN_CHAT_ID=xxx

# QuickBooks
QUICKBOOKS_CLIENT_ID=xxx
QUICKBOOKS_CLIENT_SECRET=xxx
QUICKBOOKS_REDIRECT_URI=xxx
QUICKBOOKS_REALM_ID=xxx

# Anthropic
ANTHROPIC_API_KEY=xxx
```

## Success Criteria

### Phase 1 Complete When:
- Email from Minseok triggers Telegram notification within 30 seconds
- AI correctly extracts sign types, quantities, sizes, special requests
- Notification includes all relevant details in readable format

### Phase 2 Complete When:
- [Create Estimate] generates draft with AI-recommended pricing
- Turnaround estimate reflects current workload
- [Approve & Send] sends estimate via QuickBooks and emails customer

### Phase 3 Complete When:
- Status inquiries get matched to correct job
- Reorder requests pull previous pricing
- `/status` and `/jobs` commands work

### Phase 4 Complete When:
- [Mark Delivered] converts estimate to invoice
- Completion email replies to original thread with PDF attached
- [Mark Paid] updates job status

## Future Considerations (Out of Scope)

- Multiple team members / role-based access
- Customer portal for self-service status checks
- Automated follow-up reminders for unpaid invoices
- Integration with shop floor scheduling software
- Analytics dashboard for pricing optimization
