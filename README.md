# Ordova Restaurant SaaS

The application now uses Supabase PostgreSQL, Auth, Realtime, and Storage. The React/RTL interfaces and Express API remain in place.

## Local setup

1. Use Node.js 20.19+.
2. Copy `.env.example` to `.env.local` and configure the values.
3. Apply the SQL files in `supabase/migrations` in filename order through the Supabase CLI or SQL editor. Existing installations only need migrations they have not run yet. `202610150001_gps_accuracy_matches_radius.sql` aligns indoor GPS accuracy checks; `202610150002_order_workflow_permissions.sql` fixes order creation after a shift reset and limits menu edits to owners/managers.
   Apply `202610180001_ordova_default_theme.sql` to make Ordova the database default for future restaurants; it does not alter existing restaurant branding.
   Apply `202610180002_staff_passcodes.sql` and `202610180003_passcode_multi_restaurant_key.sql` before deploying the four-digit staff sign-in code.
4. Run `npm install` and `npm run dev`.

Create the first system administrator only from a trusted server shell with a service-role key: `npm run create:admin -- <username> <strong-password>`. The script requires at least 12 password characters and never exposes the service-role key to the browser.

The browser receives only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and the public Web Push key. `SUPABASE_SERVICE_ROLE_KEY`, Firebase migration credentials, Gemini/OpenAI keys, and Web Push private keys are server/worker-only.

## Vercel deployment

Import the repository with **Root Directory** set to the folder containing `package.json`, `server.ts`, `api/index.ts`, and `vercel.json`. Use the Vite framework preset and `npm run build` as the build command. The Vercel function routes `/api/*` to the existing Express API; a frontend-only deployment cannot sign users in or submit orders.

Set these environment variables for Production (and Preview if needed), then redeploy so Vite embeds the public values at build time:

- `VITE_SUPABASE_URL` and `SUPABASE_URL`: your Supabase project URL.
- `VITE_SUPABASE_ANON_KEY` and `SUPABASE_ANON_KEY`: the project's publishable/anon key.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only, required for privileged admin, restaurant, and staff operations. Never prefix this variable with `VITE_`.
- `PASSCODE_SECRET`: server-only 64-character hex key (32 random bytes), required for owner/waiter/kitchen passcodes. Generate with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Keep the same key in every deployment; changing or losing it makes existing passcodes unreadable and unmatchable. Never prefix it with `VITE_`.
- `VITE_WEB_PUSH_PUBLIC_KEY` if staff notifications are enabled. For AI chat, set `GEMINI_API_KEY` for Gemini and/or `OPENAI_API_KEY` for GPT on the server. The system administrator chooses the provider and model in **AI assistant** settings; chat uses that provider's key automatically. The existing Supabase service-role key is required to read these saved settings server-side. Never use a `VITE_` prefix for either AI key. Add the chosen key to Vercel's server environment variables and redeploy after changing it.

For waiter push alerts, set `VITE_WEB_PUSH_PUBLIC_KEY` in Vercel Production to the **same public VAPID key** used as `WEB_PUSH_PUBLIC_KEY` by the Supabase `notification-dispatcher`, then redeploy. The private VAPID key stays only in Supabase Edge Function secrets. Each waiter must enable notifications on their own HTTPS browser/device; a successful build or empty notification outbox does not prove push delivery.

On iPhone, add the specific waiter or kitchen page to the Home Screen, then open that icon (not the Safari tab), sign in, and enable alerts. Use **Test this device** to check whether iOS displays a local notification. If it does not, check iPhone Settings → Notifications for that Home Screen app and check Focus mode. If the local test appears but call/order alerts do not, inspect `notification_deliveries` for that device and the matching `notification_outbox` event; a `sent` delivery means the push service accepted it, not that iOS displayed it. The notification dispatcher uses a declarative Web Push notification for compatible iOS versions and a service-worker fallback for older devices. Keep `WEB_APP_URL` set to the public HTTPS application origin if it differs from `https://menu.novx-team.com`.

After deployment, open `https://<your-deployment>/api/health`; it must return JSON with `status: "ok"`, not the application's HTML or a 404. Then sign in with an admin account created in the **same Supabase project** using `npm run create:admin -- <username> <strong-password>` in a trusted local/server shell. Do not put the service-role key or admin password in the browser or a public Vercel variable. The internal username is converted to `<username>@accounts.novx.invalid`; a different Supabase project or an uncreated account will return incorrect credentials. If sign-in still fails, inspect the `/api/auth/login` response and Vercel function logs without sharing the password or secret keys.

### Four-digit owner and staff sign-in rollout

1. Apply `202610180002_staff_passcodes.sql` and `202610180003_passcode_multi_restaurant_key.sql` in the same Supabase project. They add a service-role-only passcode table and database-backed attempt limits, and allow a user to belong to multiple restaurants; they do not delete users or restaurant data.
2. Add the same `PASSCODE_SECRET` to the local server and Vercel server environment, then deploy the API/UI together. Keep the secret in your password manager. Do not place it in source control or browser environment variables.
3. An administrator signs in using the existing username and strong password, opens each existing restaurant's **Edit** screen, and reads or changes the owner's four-digit code. Opening this screen provisions a code for an older account. For newly created restaurants, the generated code appears immediately after saving.
4. An owner signs in through the restaurant-specific link using the on-screen keypad, then opens each existing waiter/kitchen member's **Edit** screen to view or change their code. New staff members receive a unique generated code on creation. Share codes privately.

Once an account receives a passcode, the server rotates its Supabase Auth password to an unknown strong value; the four digits themselves are never used as a Supabase password. Existing active sessions are not forcibly revoked by this change. The passcode table has no browser RLS policies, and only the authorized admin or restaurant owner can retrieve a decrypted code via the API. Codes are globally unique, so there are at most 10,000 possible assignments; the server will return an error if the space is exhausted. Four digits are inherently weaker than a strong password, even with the included per-IP and per-restaurant attempt limits—protect restaurant login links and consider a stronger second factor if risk increases. If the SQL migration or secret is missing, keep the previous deployment live until setup is complete; do not deploy the keypad-only UI first. A rollback to the previous app version preserves all original accounts and data, but accounts whose passwords were rotated will need an administrator to reset their old password if you return to the username/password workflow.

## Migration

See [SUPABASE_MIGRATION.md](SUPABASE_MIGRATION.md). Do not delete Firebase data until count validation, application acceptance tests, and the rollback window are complete.

## Verification

```sh
npm run lint
npm test
npm run build
npm audit --omit=dev
```

With the local server running and a service-role key configured, `npm run test:backend` exercises temporary restaurant/customer/order/staff workflows against the connected Supabase project and removes its test records afterward. Do not use it against production during customer service hours.

After applying the database locally, run `supabase test db` for RLS isolation tests.
