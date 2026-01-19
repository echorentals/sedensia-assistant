# Phase 5: Invoicing & Job Completion - Design

**Date:** 2026-01-18
**Status:** Implemented

## Overview

Automate the job completion and invoicing workflow. When a job is marked completed, the system converts the estimate to an invoice, drafts a completion email, and sends it for Telegram approval before emailing the customer with the invoice attached.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Invoice trigger | On completion | Marking job `completed` auto-triggers invoicing - fewer manual steps |
| PDF storage | QuickBooks only | Store QB invoice ID, fetch PDF on demand - simpler, no storage costs |
| Invoice delivery | Attach PDF | Download from QB and attach to email directly |
| Payment tracking | Manual `/paid` | Simple and reliable, no webhook complexity |

## High-Level Flow

```
/stage abc123 completed
    │
    ▼
┌─────────────────────────────┐
│ Convert Estimate → Invoice  │
│ Download PDF from QB        │
└─────────────────────────────┘
    │
    ▼
┌─────────────────────────────┐
│ AI drafts completion email  │
│ (match original language)   │
└─────────────────────────────┘
    │
    ▼
┌─────────────────────────────┐
│ Telegram review message     │
│ [Send] [Edit] [Skip]        │
└─────────────────────────────┘
    │
    ▼ (on Send)
┌─────────────────────────────┐
│ Reply to Gmail thread       │
│ with PDF attached           │
└─────────────────────────────┘
    │
    ▼
┌─────────────────────────────┐
│ Update job → invoiced       │
│ Create invoice record       │
└─────────────────────────────┘
```

## Database Changes

### New Table: `invoices`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| job_id | uuid | FK to jobs |
| estimate_id | uuid | FK to estimates |
| quickbooks_invoice_id | text | QuickBooks reference |
| total | decimal | Invoice total |
| sent_at | timestamptz | When completion email sent |
| paid_at | timestamptz | When payment received |
| created_at | timestamptz | Record creation |

### Update Job Stages

Current: `pending` → `in_production` → `ready` → `installed` → `completed`

New: `pending` → `in_production` → `ready` → `installed` → `completed` → `invoiced` → `paid`

- `completed` - Delivery confirmed, triggers invoicing flow
- `invoiced` - Invoice created and sent to customer
- `paid` - Payment received

## QuickBooks API Functions

### `createInvoiceFromEstimate(estimateId: string)`

Converts an estimate to an invoice:
1. Fetch estimate details from QB
2. Create invoice with same line items and customer
3. Return new invoice object

### `getInvoicePdf(invoiceId: string)`

Downloads invoice PDF:
- `GET /invoice/{id}/pdf` with `Accept: application/pdf`
- Returns PDF as Buffer

### `getInvoice(invoiceId: string)`

Fetches invoice details for display.

## AI Completion Email

### Function: `draftCompletionEmail(input)`

Input:
- `contactName` - Customer name
- `companyName` - Company name
- `jobDescription` - What was delivered
- `invoiceNumber` - QB invoice number
- `invoiceTotal` - Amount due
- `language` - `ko` or `en`

Output: Professional completion email with:
- Delivery confirmation
- Project summary
- Invoice reference
- Payment terms reminder
- Thank you note

## Telegram Notifications

### Completion Review Message

```
✅ Job Complete - Samsung

Job: #abc123 - Channel Letters
Total: $4,936.20

━━━━━━━━━━━━━━━━━━
📝 Completion Email Draft:
"Hi Minseok, the channel letters have been
delivered. Please find invoice #INV-1042
attached..."

📎 Invoice: INV-1042.pdf

[Send] [Edit] [Skip Invoice]
```

### Callbacks

| Callback | Action |
|----------|--------|
| `complete_send:{jobId}` | Send email with PDF, update to `invoiced` |
| `complete_edit:{jobId}` | Open edit flow for email text |
| `complete_skip:{jobId}` | Update to `invoiced` without email |

## Payment Tracking

### `/paid <job_id>` Command

```
/paid abc123

✅ Job #abc123 marked as paid

Invoice: INV-1042
Amount: $4,936.20
Customer: Samsung (Minseok Kim)
```

Updates:
- `jobs.stage` → `paid`
- `invoices.paid_at` → current timestamp

### Error Cases

- Job not found → "Job not found"
- Not invoiced → "Job must be invoiced before marking paid"
- Already paid → "Job already marked as paid on [date]"

## Implementation Components

| Component | Files | Changes |
|-----------|-------|---------|
| Database | `007_invoices.sql` | New table, update stage enum |
| QuickBooks | `client.ts` | Add invoice functions |
| AI | `drafter.ts` | Add `draftCompletionEmail` |
| Gmail | `client.ts` | Add PDF attachment support to `replyToThread` |
| Telegram | `bot.ts`, `callbacks.ts` | Completion notification, `/paid` command |
| Jobs | `callbacks.ts` | Hook `/stage completed` to trigger flow |

## Success Criteria

- [x] `/stage <id> completed` triggers invoice creation
- [x] Completion email drafted in correct language
- [x] Telegram shows review with PDF attachment indicator
- [x] [Send] replies to original Gmail thread with PDF
- [x] `/paid <id>` updates job and invoice records
