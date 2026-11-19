# SaaS administration upgrade — implementation and rollout notes

## Status

Implemented in the working repository. The migration has NOT been applied to
production and this upgrade has NOT been deployed. Existing restaurant access,
WAYL renewals, staff orders and Gupshup onboarding are retained. No production
financial data or sample subscription prices were inserted. No paid API calls
were made during verification.

This is a working accounting/billing and AI administration foundation, not a
claim that every capability in the complete dashboard specification is finished.
The remaining work below is explicit, rather than represented by fake controls.

## Implemented

- An expandable Finance / AI operations / Subscriptions workspace in the existing
  platform administrator dashboard, with Arabic RTL/English forms, date ranges,
  restaurant filtering, an accessible revenue/expense plot, detailed tables,
  50-row pagination, CSV current-page exports and browser printing.
- Immutable plan versions, explicit effective dates, editable future versions,
  monthly prices, flexible validated session/inbound/AI call limits, per-restaurant
  overrides and subscription states. Mid-cycle agreed-price changes are rejected.
- Fixed 24-hour ORDOVA session metering from unique authenticated inbound jobs.
  This is NOT Meta's billing definition. Metering begins at migration installation;
  historical sessions are not guessed or backfilled from incomplete retained chats.
- Commercial quotas layered on the existing admission/spam policy, tenant advisory
  locks, atomic AI reservations and existing per-customer, spending and subscription
  safety caps. Unmanaged restaurants keep their current safety limits. Expired,
  suspended and cancelled managed subscriptions cannot start chargeable AI work.
- New invoice accounting with immutable original currency, frozen FX, separate plan,
  overage, discount and tax amounts. Repeat invoice creation returns the existing
  invoice; overlapping periods are rejected. Manual partial payments, idempotent
  payment references, bounded refunds and outstanding balances are supported.
- Overage invoices require an explicit recorded acceptance reference. No gateway
  charge is initiated. Final overage invoices can only be generated after the
  period closes; no silent advance estimate is charged.
- Immutable actual expense records, allocated restaurant costs, signed correction
  entries, vendor-reference uniqueness, accrued-versus-cash dates and frozen FX.
  Negative reversals are bounded against the original expense and currency/tenant.
- IQD/USD original transactions; consolidated accounting reports in IQD. An
  effective USD-to-IQD rate is required for USD invoices/expenses. The report never
  adds estimated OpenAI cost to actual vendor expenses, preventing that double count.
- Earned revenue allocated linearly over the invoice's service period, excluding
  collected sales tax; collected payments and receivables shown separately. Legacy
  WAYL cash is separately labelled and is not added to invoice income automatically.
- Paid active monthly MRR and ARR run rate, actual direct/operating/tax expenses,
  gross/operating/net profit, net margin, per-restaurant contribution records and
  negative-contribution indicators. MRR is current paid monthly commitment, not a
  historical as-of-date metric or a substitute for recognized revenue.
- Measured OpenAI token counts, cached tokens, per-model estimates, request latency,
  inbound/outbound counts, automated notifications, failed/read delivery counts,
  scope flags and duplicate/spam counters. Scope flags are approximate detector
  results, not a guarantee of detected prompt injection.
- Runtime admin controls for WhatsApp AI enablement, daily calls, monthly AI USD
  safety budget, customer rate limit, model ID, input/cached/output rates, output
  token limit and timeout. API keys remain environment-only. Model availability
  still depends on the project's real provider access. Existing Responses strict
  tool calling and deterministic order authorization remain in place.
- Model pricing snapshots are attached to measured usage. Configuration changes
  are immediate and audited; historical estimates are not recalculated with new
  prices. Existing environment fallback works when no runtime override exists.
- In-dashboard overdue invoice, provider reconnect and imminent subscription
  expiry indicators. The existing staff/status notification system is unchanged.
- A small, explicitly estimated forecasting calculator with 10/20/50/100/500/1000
  restaurant presets and custom count, price, fixed cost and per-restaurant cost.
  It does not write accounting records or claim measured savings.

## Authorization and integrity

New finance tables enable RLS. Authenticated platform admins may read; owners and
anonymous users cannot. Writes use narrow SECURITY DEFINER functions with an
explicit verified `app_metadata.system_role=admin` check, empty search_path and
revoked PUBLIC/anon execution. This is needed to aggregate the existing private
WhatsApp/payment tables without exposing them to owners. No service credentials
are sent to the browser. Trigger functions are not callable by browser roles.
Financial writes are audited. Posted invoices, payments, expenses, FX rates and
plan versions cannot be updated/deleted, even by ordinary service writes.
Subscription changes preserve audit before/after snapshots. Audit entries have
no customer transcripts or provider keys. Session counts survive transcript
retention cleanup without retaining customer phone numbers.

## Reporting policy

Baghdad dates are inclusive in the UI and converted to [start at 00:00+03:00,
day after end at 00:00+03:00). A January monthly service period should therefore
use Jan 1 00:00+03:00 through Feb 1 00:00+03:00. Numeric PostgreSQL calculations
are authoritative; JavaScript only formats results and calculates hypothetical
forecast scenarios. Invoices issued after a report's closing date are excluded
from that historical as-of report. Provider estimates are USD estimates; missing
usage remains null/unmeasured, never fabricated as actual zero expense.

## Files

- supabase/migrations/20261119024358_saas_admin_finance_billing.sql
- src/components/AdminSaasConsole.tsx (new workspace)
- src/components/AdminDashboard.tsx (workspace entry)
- whatsapp/agent.ts (bounded runtime model configuration/pricing)
- whatsapp/worker.ts (runtime selection, latency, pricing snapshots)
- scripts/saas-admin.test.ts (new deterministic database/API-contract tests)
- package.json (test:saas-admin command)
- docs/saas-admin-upgrade.md

## Rollout

1. Review and apply the single new migration to a staging database first. No new
   extensions, environment variables or paid services are required.
2. Sign in with an existing platform administrator. Open the new workspace at the
   top of the admin dashboard. Restaurant owners must not have the admin claim.
3. Configure effective exchange rates; create real plan versions and assign real
   periods. Existing restaurant subscriptions are not auto-migrated or repriced.
4. Record invoices, actual payments and actual vendor expenses only from evidence.
   Do not re-record a WAYL collection as a manual payment without reconciling its
   allocation. The legacy gateway is deliberately shown separately.
5. Validate with representative staging tenants and roles before production.
   Reconcile migration/schema rollout with application deployment; the new worker
   usage columns and quota functions must exist before deploying this code.

## Remaining work before the entire requested specification is complete

- Unified legacy WAYL-to-invoice allocation and subscription/access-lifecycle
  reconciliation. The managed commercial period does not yet renew/change the
  existing restaurant's operational end_date. Keep existing renewal controls until
  this integration is completed; do not treat a commercial assignment as payment.
- Recurring-expense materialization/scheduling, receipt upload/storage, automatic
  provider invoice imports and billing-event reconciliation. Actual vendor bills
  must currently be entered manually with unique references.
- Provider country/category rate schedules, verified Meta billable categories,
  contractual free allowances, verified messaging cost meters and FX gain/loss
  accounting. The current reports never claim these unavailable measurements.
- Full multi-currency consolidated USD reporting, accrual journals for late billing,
  deferred-tax treatment, journal-level accounting approvals and accounting exports.
- Scheduled future model-pricing changes, model availability checks, plan-based
  model defaults, purchased packs, token/outbound/voice quotas, annual/setup-fee
  plan billing, automatic renewals, proration and automated payment collection.
  Unsupported limit keys are rejected rather than stored as unenforced controls.
- Full per-plan forecast distributions, churn/growth cohorts, sensitivity modelling,
  CAC/break-even analysis, configurable alert thresholds and deduplicated background
  reminder notifications. Current inline alerts do not send external messages.
- Complete polished restaurant drill-down/printable single-invoice layouts, complete
  table localization/sorting/search, all report presets, and browser visual QA.
- Real voice provider/calling integration. Voice is explicitly unavailable; no fake
  calls, minutes, allowance consumption or cost is generated.

## Verification

Use `npm run test:saas-admin`, `npm run test:whatsapp`, `npx tsc --noEmit`, and
`npm run build`. Tests use in-process PostgreSQL plus mocked provider responses.
SaaS tests cover authorization, RLS, plan immutability, assignment, invoice
idempotency, unpaid/partial/refunded amounts, tax exclusion, Baghdad accounting
boundaries, FX snapshots, expense reconciliation, tenant filtering, audit safety,
subscription restrictions, session caps, overlapping reservation requests,
explicit quota overrides and runtime model cost/parameter enforcement.
The in-process database serializes client queries; this is not a substitute for
multi-connection load testing against PostgreSQL before production rollout.
