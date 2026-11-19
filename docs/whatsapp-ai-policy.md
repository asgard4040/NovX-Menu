# WhatsApp assistant policy

This extends the existing provider webhook → durable queue → intent classifier →
server-rendered reply → existing quote/order writer. Meta and Gupshup onboarding,
credentials, delivery receipts, waiter approval and kitchen transitions remain
the existing implementations. There is no second ordering or payment system.

## Rollout

Apply `supabase/migrations/20261118235748_whatsapp_assistant_policy.sql` after the
existing WhatsApp migrations, then deploy the application. On November 19, 2026
(Baghdad time), this migration was applied to the ORDOVA production Supabase
project and deployment `dpl_CB4VTddYvU9N21eQ1VXyTySYuXZH` was promoted to
`rest.ordova.cc` and `menu.ordova.cc`. All 31 focused WhatsApp tests passed in the
isolated release checkout. Production checks verified RLS/service-role grants,
the authenticated owner dashboard's budget controls and usage metrics, and 401
responses for unauthenticated webhook, worker and owner-API requests. No live
customer messages were sent as part of this release verification. For future
rollouts, apply database changes first; the old reservation RPC remains callable
by old workers during rollout.

The migration adds `whatsapp_settings.ai_policy`, cached-token and reservation
columns in `whatsapp_usage`, an aggregate-only `whatsapp_metrics` table with RLS,
indexes and service-only context/admission/reservation RPCs. It wraps ingestion
for duplicate telemetry and pruning for 90-day aggregate retention. Existing
data relationships, queue states and order functions are preserved. Earlier
unmeasured attempts receive a conservative $0.02 reservation for budget checks;
inspect usage before setting tight limits on an established restaurant.

## Configuration

Owners can configure daily/monthly AI budgets, monthly AI attempts and customer
daily messages in WhatsApp AI → Assistant usage limits. Existing daily AI
attempts remain configurable. The authenticated owner/admin settings API also
accepts the complete `ai_policy` object; unknown keys and invalid ranges fail.
Omitting it preserves the existing policy. Limits belong to the current tenant.

| Policy key | Default | Meaning |
|---|---:|---|
| `customer_daily_requests` | 100 | Inbound messages per conversation per UTC day |
| `customer_rpm` | 12 | Inbound messages per customer per rolling minute |
| `restaurant_rpm` | 120 | Inbound messages per restaurant per rolling minute |
| `monthly_requests` | 4500 | AI attempts per restaurant per UTC month |
| `conversation_responses` | 80 | Automated replies per conversation per rolling 24 hours |
| `daily_budget_usd` | 1 | Conservative daily AI spending reservations |
| `monthly_budget_usd` | 10 | Conservative monthly AI spending reservations |
| `request_max_usd` | 0.02 | Maximum reservation for one AI attempt |
| `max_input_chars` | 2000 | Customer text/combined burst size before AI |
| `max_response_chars` | 1200 | Normal reply limit; full deterministic quotes are exempt |

Zero monetary budgets disable model calls, while menu and other supported fast
paths continue. Daily AI attempts and a 30-AI-attempts/minute tenant cap also
apply. Rate, conversation and identical-message violations are silently
suppressed to avoid paid reply loops; other admission failures have at most one
notice per customer per ten minutes, with a tenant-wide notice cap. Explicit
out-of-scope requests receive at most two redirects per ten minutes. Repeated
AI-budget/failure notices are suppressed. Retrying an inbound job reuses its
persisted admission result.

Server environment (all optional for the default model):

| Variable | Default / use |
|---|---|
| `WHATSAPP_OPENAI_MODEL` | Existing `gpt-6-luna` default retained |
| `WHATSAPP_OPENAI_MAX_OUTPUT_TOKENS` | 1800; validated range 800–4000, including reasoning/tool arguments |
| `WHATSAPP_OPENAI_INPUT_USD_PER_MILLION` | 0.10 for exact `gpt-6-luna`; otherwise required for cost admission |
| `WHATSAPP_OPENAI_CACHED_INPUT_USD_PER_MILLION` | 0.01 for exact `gpt-6-luna`; otherwise input rate unless configured |
| `WHATSAPP_OPENAI_OUTPUT_USD_PER_MILLION` | 0.50 for exact `gpt-6-luna`; otherwise required for cost admission |
| `WHATSAPP_GUPSHUP_TEXT_USD_PER_MESSAGE` | 0.001; platform-fee estimate only |

Use rates matching the selected model and processing tier. Budget reservations
use a conservative UTF-8 input-size allowance and the full output token limit.
Measured input, cached input and output usage are recorded separately. Failed
or unknown usage retains its reservation; completed calls also retain at least
the reservation for admission purposes. This can stop calls before the displayed
usage estimate reaches a budget. It is not an OpenAI billing guarantee. Provider
estimates count logical inbound messages and submitted sends, may include failed
submissions, and exclude Meta delivery fees, taxes and account-specific discounts.
Neither estimate replaces the providers' invoices. No minimum savings percentage
is asserted.

## Context, behavior and security

* Stable server-owned instructions are separate from the JSON data input.
  Customer text, history and database strings never enter a high-priority role.
* The model classifies an allowlisted action and IDs; it cannot emit customer
  prose, prices, totals, arbitrary tool calls, SQL or order/payment actions.
  Replies use brief Iraqi Arabic/English templates and verified database values.
  Formal welcome uses the existing restaurant tone setting.
* Only a tenant-scoped, capped selection of at most 24 menu rows reaches the
  classifier, plus at most four short history entries and the structured draft.
  Names/categories are data; descriptions/ingredients are not model instructions.
  Product-related responses re-read selected IDs in the same tenant after AI.
  Missing/non-finite prices are never rendered as zero.
* Exact menu/link, location, hours and contact requests bypass AI. Location uses
  the existing verified address/map fields. Hours are explicitly pickup-ordering
  hours, not inferred business hours. The existing manager phone is private and
  is never presented as a public restaurant contact number.
* Public-contact, promotion, preparation-time and general opening-hours data are
  not inferred. Missing facts are acknowledged briefly or referred to staff.
  Allergy/policy requests use the existing staff handoff. Delivery ordering now
  uses owner-configured coverage/fees and a verified contact/address state; see
  [delivery setup](whatsapp-delivery-ordering.md). Pickup remains supported.
* Existing provider authentication, tenant mapping, message-ID deduplication,
  encryption and service-window checks are retained. The Gupshup bearer callback
  credential remains necessary; app names alone do not authenticate a request.
* Server output validation rejects unknown actions, extra fields, foreign/unknown
  product IDs, duplicate cart IDs, bad quantities and unsupported modifiers.
  Prices and availability are independently validated by existing SQL pricing.
  Explicit confirmation must still match the precise active quote; a model
  decision cannot submit an order, confirm payment or inspect another customer's
  order. Order status uses only the authenticated provider conversation linkage.
* Admission and monetary reservations lock tenant settings and use job leases.
  Simultaneous attempts cannot independently pass the same recorded budget.
  Short bursts combine up to four text fragments over three seconds into one
  bounded input. Button and context-bound confirmations are excluded.
* Prompt-attack detection is a high-confidence optimization, not a complete
  detector. Unrecognized/obfuscated attacks still face constrained outputs and
  backend authorization. No claim of complete prompt-injection prevention is made.
* Billing-exhausted OpenAI failures fail fast rather than retrying five times.
  Retryable provider/timeouts retain the existing bounded retry/idempotency rules.
  Uncertain sends are not blindly resent. Database outages may delay a reply;
  sending outside the durable queue would risk duplicate messages.
* Logs contain job, tenant, conversation and error identifiers, not message text
  or credentials. Existing retention prunes content. Aggregate counters include
  blocked, batched and observed duplicate webhook events; they do not log secrets.

## Verification

Run `npm run test:whatsapp`, `npx tsc --noEmit`, and `npm run build`. The focused
suite uses real in-process PostgreSQL migrations, service-role/RLS behavior,
queue/worker/HTTP boundaries and mocked Meta, Gupshup and OpenAI responses.

Policy scenarios include: fast-path menu/address/hours/contact; product price and
unavailability; missing price; unrelated topics; developer/system impersonation;
API-key/database extraction; foreign tenant IDs; oversized/very long responses;
injected descriptions; nonexistent discounts; repeated spam; rapid fragments;
unrecognized order tools; explicit confirmation; billing/network/incomplete AI
failures; customer rate/size/conversation limits; parallel tenant requests; and
competing budget reservations and monthly quotas. Existing tests preserve the
Gupshup and Meta waiter/kitchen handoff, replay protection and delivery behavior.

Limitations: mocked model outputs verify backend boundaries and failure paths,
not a linguistic or real-model jailbreak success rate. PGlite serializes database
work; the competing-request test verifies the reservation result, not hosted
PostgreSQL lock scheduling under load. No unrelated full-project test campaign
or production load/security audit was performed. Iraqi dialect quality and
recommendation relevance still need live evaluation against each real menu.

## Changed files

`whatsapp/{agent,worker,routes}.ts`, new `whatsapp/{instructions,policy,context}.ts`,
`src/components/WhatsAppSettings.tsx`, `.env.example`, `package.json`,
`scripts/whatsapp.test.ts`, `scripts/whatsapp-test-transport.ts`, new
`scripts/whatsapp-policy.test.ts`, this guide and the policy migration. A production
build regenerates `server.js`/`dist`; other pre-existing workspace edits were not
part of this change.
