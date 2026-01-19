# Sedensia Business Assistant - Design Document

**Date:** 2026-01-18
**Status:** Implemented ✅
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

### `oauth_tokens`
Persistent storage for OAuth tokens (Gmail, QuickBooks).

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| provider | text | `gmail` or `quickbooks` |
| access_token | text | Current access token (encrypted) |
| refresh_token | text | Refresh token (encrypted) |
| token_type | text | Usually `Bearer` |
| expires_at | timestamptz | Access token expiration |
| scope | text | Granted OAuth scopes |
| realm_id | text | QuickBooks company ID (null for Gmail) |
| updated_at | timestamptz | Last token refresh |
| created_at | timestamptz | Initial authorization |

## OAuth Token Management

Both Gmail and QuickBooks use OAuth 2.0 with short-lived access tokens. Proper token handling is critical for uninterrupted operation.

### Token Characteristics

| Provider | Access Token TTL | Refresh Token TTL | Notes |
|----------|------------------|-------------------|-------|
| Gmail | 1 hour | 6 months (or until revoked) | Refresh token may expire if unused |
| QuickBooks | 1 hour | 100 days | Must refresh before expiry |

### Token Refresh Strategy

```
┌─────────────────────────────────────────────────────────────┐
│                    API Request Flow                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  API Call Initiated                                         │
│       │                                                     │
│       ▼                                                     │
│  ┌─────────────────────────────────┐                       │
│  │ Check token expiry              │                       │
│  │ (expires_at - 5 min buffer)     │                       │
│  └─────────────────────────────────┘                       │
│       │                                                     │
│       ├── Token valid ──────────────────► Make API call    │
│       │                                                     │
│       ▼ Token expired/expiring                             │
│  ┌─────────────────────────────────┐                       │
│  │ Call refresh token endpoint     │                       │
│  └─────────────────────────────────┘                       │
│       │                                                     │
│       ├── Success ──► Update DB ──► Make API call          │
│       │                                                     │
│       ▼ Refresh failed                                      │
│  ┌─────────────────────────────────┐                       │
│  │ Notify admin via Telegram       │                       │
│  │ "Re-authorization required"     │                       │
│  └─────────────────────────────────┘                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Implementation Approach

1. **Token Wrapper Class**: Each API client (Gmail, QuickBooks) wraps token retrieval
   - Before each API call, check `expires_at`
   - If within 5-minute buffer, proactively refresh
   - Update database with new tokens

2. **Proactive Refresh Job**: Background task runs every 30 minutes
   - Query tokens expiring within next hour
   - Refresh them preemptively
   - Reduces latency on actual API calls

3. **Failure Handling**:
   - If refresh fails (revoked, expired refresh token), send Telegram alert
   - Include re-authorization link in alert
   - Log failure for debugging

4. **Security**:
   - Encrypt tokens at rest using application secret
   - Never log token values
   - Use Supabase RLS to restrict token table access

### Re-authorization Flow

When refresh tokens expire or are revoked:

```
Telegram Alert:
⚠️ QuickBooks authorization expired

QuickBooks access has been revoked or expired.
Please re-authorize to continue creating estimates.

[Re-authorize QuickBooks]
```

Button links to: `GET /auth/quickbooks/authorize`

OAuth callback updates tokens in database, sends confirmation:

```
✅ QuickBooks re-authorized successfully
```

### Phase 1 OAuth Tasks
- [x] Create `oauth_tokens` table with encryption
- [x] Implement Gmail token refresh wrapper
- [x] Add Telegram alert for auth failures
- [x] Create `/auth/gmail/authorize` and callback endpoints

### Phase 2 OAuth Tasks
- [x] Implement QuickBooks token refresh wrapper
- [x] Create `/auth/quickbooks/authorize` and callback endpoints
- [x] Add proactive token refresh background job

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
- [x] Project setup (TypeScript, Fastify, environment config)
- [x] Supabase schema: `contacts` table
- [x] Gmail API OAuth setup + Pub/Sub webhook
- [x] Telegram bot basic setup
- [x] Claude integration for email parsing
- [x] End-to-end: email received → parsed → Telegram notification

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
- [x] Supabase schema: `jobs`, `job_items`, `estimates`, `pricing_history`
- [x] QuickBooks OAuth setup
- [x] Pricing recommendation engine
- [x] Turnaround calculator
- [x] Telegram inline buttons for approval
- [x] Estimate creation → approval → send flow

## Phase 3: Dashboard & Admin Interface ✓

### Goal
Provide a web-based dashboard for managing jobs, estimates, contacts, and pricing analytics.

### Status: COMPLETE

### Features Implemented
- **Authentication** - Supabase Auth with login page
- **Dashboard Home** - Stats overview (active jobs, pending estimates, revenue)
- **Jobs Page** - List with inline stage editing, ETA management
- **Estimates Page** - List of estimates with status tracking
- **Contacts Page** - Add/toggle monitored contacts
- **Pricing Analytics** - Historical pricing data and win rates

### Technology
- Next.js 15 (App Router)
- Supabase client for data
- Tailwind CSS for styling
- Deployed on Netlify

## Phase 4: Status Inquiries & Reorder Requests ✓

### Goal
Handle status inquiries, reorder requests, and automated response drafting with multi-language support.

### Status: COMPLETE

### Language Handling

The system supports Korean and English:
- **Email responses** - Match the language of the original email (Korean email → Korean response)
- **Telegram messages** - Use each user's language preference (default: Korean)

### New Database Table: `telegram_users`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| telegram_id | text | Telegram user ID (unique) |
| name | text | Display name |
| language | text | `ko` or `en`, default `ko` |
| created_at | timestamptz | Record creation |

### Intent Detection

Expand AI parser to classify incoming emails:

| Intent | Example | Action |
|--------|---------|--------|
| `new_request` | "Can you quote 10 monument signs?" | → Phase 1 flow |
| `status_inquiry` | "What's the status on the channel letters?" | → Match job → draft response |
| `reorder` | "Can we get the same wayfinding signs from last month?" | → Find previous order → show pricing |
| `approval` | "Approved, please proceed" | → Update job to `approved` |
| `general` | "Thanks!" / scheduling chat | → Notify only, no auto-action |

### Job Matching Strategy

When a `status_inquiry` or `reorder` email arrives:

1. **Filter by contact** - Only search jobs from the same sender's company
2. **Keyword extraction** - AI extracts key terms (e.g., "channel letters", "Taylor facility")
3. **Fuzzy match** - Search job descriptions and estimate items for keywords
4. **Recency bias** - Prefer recent jobs (last 90 days) over older ones
5. **Confidence score** - If multiple matches or low confidence, show options in Telegram

### Status Inquiry Flow

```
Email: "채널 레터 진행 상황이 어떻게 되나요?"
    │
    ▼
┌─────────────────────────────────┐
│  AI Intent Detection            │
│  Intent: status_inquiry         │
│  Language: ko                   │
│  Keywords: "채널 레터"           │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  Job Matcher                    │
│  Query recent jobs by contact   │
│  + fuzzy match on description   │
│  Found: Job #abc123 (92% match) │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  AI Response Drafter            │
│  Draft status update in Korean  │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  Telegram Notification          │
│  (in user's language pref)      │
└─────────────────────────────────┘
```

### Telegram Status Inquiry Format (Korean)

```
❓ 상태 문의 - Samsung

발신: 김민석
제목: Channel Letters 진행 상황

매칭된 작업: #abc123
현재 단계: 제작 중 (in_production)
예상 완료: 1월 24일

━━━━━━━━━━━━━━━━━━
📝 답변 초안:
"안녕하세요 민석님, 채널 레터 제작 현황
안내드립니다. 현재 제작 중이며 1월 24일
완료 예정입니다..."

[보내기] [수정] [무시]
```

### Telegram Status Inquiry Format (English)

```
❓ Status Inquiry - Samsung

From: Minseok Kim
Subject: Channel Letters Progress

Matched Job: #abc123
Current Stage: In Production
ETA: Jan 24

━━━━━━━━━━━━━━━━━━
📝 Draft Response:
"Hi Minseok, here's an update on the channel
letters. Currently in production, estimated
completion Jan 24..."

[Send] [Edit] [Ignore]
```

### Reorder Flow

```
Email: "지난달 안내 표지판 동일하게 추가 주문 가능할까요?"
    │
    ▼
┌─────────────────────────────────┐
│  AI Intent Detection            │
│  Intent: reorder                │
│  Keywords: "안내 표지판", "지난달" │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  Find Previous Order            │
│  Search estimates by contact    │
│  + keywords + date range        │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  Telegram Notification          │
│  Show previous items + pricing  │
└─────────────────────────────────┘
```

### Telegram Reorder Format (Korean)

```
🔄 재주문 요청 - Samsung

발신: 김민석
"지난달 안내 표지판 동일하게 추가 주문 가능할까요?"

━━━━━━━━━━━━━━━━━━
📋 이전 주문 (2025-12-15):
• Wayfinding Signs (12"×8") × 8 ... $960
  단가: $120

총액: $960

[동일 가격으로 견적 생성] [가격 수정] [무시]
```

### Edge Cases

**No match found:**
```
❓ 상태 문의 - Samsung

이전 주문을 찾을 수 없습니다.
"wayfinding signs" 검색 결과 없음

[새 견적으로 처리] [수동 검색]
```

**Multiple matches:**
```
❓ 상태 문의 - Samsung

여러 작업이 검색되었습니다:

1. #abc123 - Channel Letters (24") - 1월 10일
2. #def456 - Channel Letters (18") - 12월 20일
3. #ghi789 - Channel Signs - 12월 5일

[1 선택] [2 선택] [3 선택]
```

### New Telegram Commands

- `/lang <ko|en>` - Set language preference
- `/status <job_id>` - Quick status lookup (shorter than `/job`)

### Implementation Tasks

**Database:**
- [x] Create `telegram_users` table with language preference

**AI Module:**
- [x] Expand parser for all intents (`status_inquiry`, `reorder`, `approval`, `general`)
- [x] Add language detection to parser output
- [x] Add response drafting function with language parameter

**Job Matching:**
- [x] Keyword extraction from emails
- [x] Fuzzy search across jobs/estimates by contact + keywords
- [x] Confidence scoring for matches

**Telegram:**
- [x] Add `/lang` command for language preference
- [x] Localized message templates (Korean/English)
- [x] Status inquiry notification + callbacks (Send/Edit/Ignore)
- [x] Reorder notification + callbacks (Create/Edit/Ignore)
- [x] Edit flow for response text

**Gmail:**
- [x] Reply-to-thread function (respond in same email thread)

**Email Processor:**
- [x] Route emails by intent to appropriate flow

## Phase 5: Invoicing & Job Completion ✓

### Goal
Convert estimates to invoices, send completion emails, track payment.

### Status: COMPLETE

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
- [x] Estimate → Invoice conversion in QuickBooks
- [x] PDF download from QuickBooks (on-demand, not stored)
- [x] Completion email composer (AI)
- [x] Gmail thread reply with PDF attachment
- [x] Payment tracking (`/paid <job_id>`)
- [x] Telegram completion notification with [Send] [Edit] [Skip] buttons
- [x] Job stages extended: `completed` → `invoiced` → `paid`

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

### Phase 1 Complete When: ✓
- Email from Minseok triggers Telegram notification within 30 seconds
- AI correctly extracts sign types, quantities, sizes, special requests
- Notification includes all relevant details in readable format

### Phase 2 Complete When: ✓
- [Create Estimate] generates draft with AI-recommended pricing
- Turnaround estimate reflects current workload
- [Approve & Send] sends estimate via QuickBooks and emails customer

### Phase 3 Complete When: ✓
- Dashboard accessible with Supabase Auth login
- Jobs, estimates, contacts, and pricing pages functional
- Deployed on Netlify

### Phase 4 Complete When: ✓
- Status inquiries get matched to correct job ✓
- Reorder requests pull previous pricing ✓
- Draft responses sent for Telegram approval before emailing ✓
- Language detection works (Korean email → Korean response) ✓
- Telegram messages respect user language preference (`/lang` command) ✓

### Phase 5 Complete When: ✓
- `/stage <id> completed` triggers invoice creation ✓
- Completion email drafted in correct language ✓
- Telegram shows review with [Send] [Edit] [Skip] buttons ✓
- [Send] replies to original Gmail thread with PDF attached ✓
- `/paid <id>` updates job and invoice records ✓

## Future Considerations (Out of Scope)

- Role-based access control (admin vs viewer)
- Customer portal for self-service status checks
- Automated follow-up reminders for unpaid invoices
- Integration with shop floor scheduling software
- Mobile app for field updates
