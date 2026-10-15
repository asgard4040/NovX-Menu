# Firebase → Supabase migration runbook

## Implemented mapping

| Firebase | Supabase |
|---|---|
| Firebase Auth/custom tokens | Supabase Auth plus `restaurant_members` |
| `restaurants` | `restaurants` |
| `waiters`, `kitchen_staff` | `staff` with constrained role |
| `menuItems` | `menu_items` |
| `orders` | `orders`, `order_items`, `order_status_history` |
| `waiter_requests` | `waiter_requests` and notification outbox |
| `security_alerts` | `security_alerts` |
| `banned_devices` | `banned_devices` |
| `settings` | `app_settings` (secrets excluded) |
| `announcements` | `announcements` |
| Firestore listeners | Tenant-filtered Supabase Realtime listeners |
| Firebase Storage/data URLs | `restaurant-assets` bucket |
| FCM | Web Push subscriptions plus `notification-dispatcher` Edge Function |

Firebase Realtime Database and Cloud Functions were not present in the repository. Existing images were URL/data fields rather than Firebase Storage SDK calls; the importer copies accessible image content and retains the original URL if copying fails.

## Safe execution checklist

1. Back up Firestore and Firebase Storage. Do not delete or modify the originals.
2. Apply the versioned SQL migration to a staging Supabase project first.
3. Configure server-only `SUPABASE_SERVICE_ROLE_KEY`, `FIREBASE_SERVICE_ACCOUNT_BASE64`, and `FIREBASE_DATABASE_ID`.
4. Configure `ADMIN_USERNAME` and `ADMIN_PASSWORD` if the legacy hard-coded administrator must be created.
5. Preview source data without writes: `npm run migrate:firebase -- --dry-run`.
6. Execute: `npm run migrate:firebase`. It upserts by `legacy_id`, creates Supabase Auth users with their existing legacy passwords, copies assets, and validates target counts. It is repeatable and never deletes Firebase records.
7. Verify owner, waiter, and kitchen authentication; QR links using legacy Firebase IDs remain supported by `resolve_restaurant_id`.
8. Run menu, order, waiter, kitchen, analytics, location, subscription, theme, and cross-tenant acceptance tests.
9. Deploy `notification-dispatcher` with legacy JWT verification enabled. Set `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `VAPID_SUBJECT`, and `CRON_SECRET` as Supabase Edge Function secrets. Store the same cron secret and the project's anon JWT in Supabase Vault as `notification_dispatcher_cron_secret` and `notification_dispatcher_anon_key`; then apply `supabase/migrations/202610150002_notification_dispatcher_schedule.sql`. The scheduled request uses both the JWT and a separate `x-cron-secret` header. Never put private keys or the cron secret in SQL migration files.
10. Switch application traffic only after staging validation. Keep Firebase read-only and available during the rollback window.

Staff must sign in to the waiter dashboard on an HTTPS origin (or localhost), select **Enable call alerts**, and allow browser notifications on each device. Supabase can confirm the dispatcher and cron job run, but actual push delivery requires a subscribed device and a real waiter request. Browser and OS notification settings can still suppress alerts.

## Auth transition

Firebase Auth was only used for anonymous/custom-token sessions; business credentials were stored in Firestore documents. The importer creates Supabase Auth accounts using synthetic internal emails (`<username>@accounts.novx.invalid`) and preserves the existing password. New restaurant and staff accounts are created server-side with the Supabase service role after verifying the caller's admin/owner membership. Passwords are never stored in application tables.

If a legacy password is missing or invalid, set a new password from an authorized administrator workflow. Synthetic internal emails cannot receive public reset emails; replace them with verified real email addresses before enabling email-based password recovery.

## Security model

- RLS is enabled on every exposed tenant table.
- Tenant access derives from `auth.uid()` and `restaurant_members`, never a client-supplied tenant ID alone.
- Public menu, geofence-validated order creation, waiter requests, device checks, and tracking use narrow `SECURITY DEFINER` functions.
- Prices and order numbers are calculated transactionally in PostgreSQL.
- Display order numbers may repeat after a shift reset; order UUIDs remain unique. The shift-reset migration removes the incompatible all-time unique order-number constraint.
- Order tracking requires a hashed bearer token.
- Role-aware triggers constrain order state transitions and immutable commercial fields.
- Storage writes require owner/manager membership in the restaurant folder.

## Location verification limits

The browser location check is a proximity safeguard, not proof of physical presence: browser coordinates can be unavailable, inaccurate, or spoofed on a compromised device. After applying `202610150001_gps_accuracy_matches_radius.sql`, the browser and database both reject missing/invalid coordinates, accuracy worse than the smaller of 150 metres and the restaurant's configured radius, and positions outside that radius. The database also independently checks subscription status and restaurant association. A typical indoor reading of 139 metres is accepted for a 150 metre radius when its reported position is inside the radius. Only the computed distance and limited device metadata are retained with an order; precise coordinate histories are not stored. For higher-assurance deployments, combine this with rotating table QR tokens or an on-premises network signal after defining that business policy.

## Cutover limitations

Historical Firebase orders did not contain customer tracking bearer tokens. Their order records and item history are preserved, but existing customer browsers cannot securely resume those historical tracking sessions after cutover; issuing a guessed or shared token would weaken access control. Staff can still see the migrated history. New Supabase orders receive per-order tracking tokens.

## Rollback

1. Stop writes or place the app in maintenance mode.
2. Compare Supabase/Firebase record counts and determine the authoritative source for the cutover interval.
3. Restore the prior application deployment and Firebase configuration from version control.
4. Re-enable Firebase writes only after reconciling any Supabase-only orders; never overwrite either data source blindly.
5. Keep Supabase snapshots and migration logs for audit/retry.

The two focused October 15, 2026 SQL fixes were applied to the connected Supabase project and verified with isolated live backend smoke tests. This does **not** mean historical Firebase data was imported or the full Firebase-to-Supabase cutover was verified. Do not remove Firebase production data until import counts and relationships are independently validated.
