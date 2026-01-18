# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sedensia Assistant automates the estimate-to-invoice workflow for Sedensia Signs, a sign fabrication business serving Samsung Taylor. The assistant monitors email for estimate requests, parses them with AI, drafts estimates based on pricing history, and manages the job lifecycle through delivery and invoicing.

## Technology Stack

- **Runtime:** Node.js 20+ with TypeScript
- **Framework:** Fastify (webhook handling, REST endpoints)
- **Telegram:** Telegraf (bot framework)
- **Database:** Supabase (PostgreSQL)
- **Email:** Gmail API with Cloud Pub/Sub push notifications
- **Invoicing:** QuickBooks Online API
- **AI:** Anthropic Claude API

## Architecture

```
Gmail (Pub/Sub) → Webhook → AI Parser → Telegram Bot
                                ↓
                           Supabase DB
                                ↑
QuickBooks API ← Estimate/Invoice Engine ← Telegram Commands
```

### Key Data Flow
1. Gmail webhook receives push notification for new emails
2. Email processor filters by configured contacts (Samsung)
3. Claude API parses email for intent and details
4. Telegram notifies user with structured summary
5. User approves estimates via Telegram inline buttons
6. QuickBooks creates/sends estimates and invoices
7. All activity logged to Supabase

## Project Structure

```
src/
├── index.ts              # Fastify server entry point
├── config/               # Environment and app configuration
├── modules/
│   ├── gmail/            # Gmail API, Pub/Sub webhook handling
│   ├── telegram/         # Telegraf bot, commands, inline handlers
│   ├── quickbooks/       # QuickBooks API client, OAuth
│   ├── ai/               # Claude API integration, prompts
│   └── jobs/             # Job lifecycle, pricing engine
├── db/                   # Supabase client, queries
└── types/                # Shared TypeScript types
```

## Commands

```bash
# Install dependencies
npm install

# Development (with hot reload)
npm run dev

# Build
npm run build

# Production
npm start

# Lint
npm run lint

# Type check
npm run typecheck

# Run tests
npm test

# Run single test file
npm test -- path/to/test.ts
```

## Key Integrations

### Gmail Webhook
- Endpoint: `POST /webhooks/gmail`
- Receives Pub/Sub push notifications
- Decodes base64 message data, fetches full email via Gmail API

### Telegram Bot
- Commands: `/status <job_id> <status>`, `/jobs`, `/paid <job_id>`
- Inline buttons for estimate approval/decline
- Admin chat ID configured via environment

### QuickBooks OAuth
- Tokens stored in database, auto-refresh on expiry
- Estimate creation, estimate-to-invoice conversion, PDF download

## Database Tables

- `contacts` - Monitored email contacts
- `jobs` - Project lifecycle tracking
- `job_items` - Line items per job
- `estimates` - QuickBooks estimate records
- `invoices` - QuickBooks invoice records
- `pricing_history` - Historical pricing for AI recommendations

## Environment Variables

See `docs/plans/2026-01-18-sedensia-assistant-design.md` for full list. Key variables:

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`
- `ANTHROPIC_API_KEY`

## AI Usage

Claude API is used for:
- **Email parsing:** Extract sign types, quantities, sizes, special requests
- **Intent detection:** Classify as new_request, status_inquiry, reorder, approval, general
- **Pricing recommendations:** Suggest prices based on history and bid success rates
- **Email composition:** Draft professional estimate and completion emails

## Design Document

Full architecture and implementation plan: `docs/plans/2026-01-18-sedensia-assistant-design.md`
