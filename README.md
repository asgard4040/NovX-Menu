# NovX Restaurant SaaS

The application now uses Supabase PostgreSQL, Auth, Realtime, and Storage. The React/RTL interfaces and Express API remain in place.

## Local setup

1. Use Node.js 20.19+.
2. Copy `.env.example` to `.env.local` and configure the values.
3. Apply the SQL files in `supabase/migrations` in filename order through the Supabase CLI or SQL editor. Existing installations only need migrations they have not run yet. `202610150001_gps_accuracy_matches_radius.sql` aligns indoor GPS accuracy checks; `202610150002_order_workflow_permissions.sql` fixes order creation after a shift reset and limits menu edits to owners/managers.
4. Run `npm install` and `npm run dev`.

Create the first system administrator only from a trusted server shell with a service-role key: `npm run create:admin -- <username> <strong-password>`. The script requires at least 12 password characters and never exposes the service-role key to the browser.

The browser receives only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and the public Web Push key. `SUPABASE_SERVICE_ROLE_KEY`, Firebase migration credentials, Gemini keys, and Web Push private keys are server/worker-only.

## Vercel deployment

Import the repository with **Root Directory** set to the folder containing `package.json`, `server.ts`, `api/index.ts`, and `vercel.json`. Use the Vite framework preset and `npm run build` as the build command. The Vercel function routes `/api/*` to the existing Express API; a frontend-only deployment cannot sign users in or submit orders.

Set these environment variables for Production (and Preview if needed), then redeploy so Vite embeds the public values at build time:

- `VITE_SUPABASE_URL` and `SUPABASE_URL`: your Supabase project URL.
- `VITE_SUPABASE_ANON_KEY` and `SUPABASE_ANON_KEY`: the project's publishable/anon key.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only, required for privileged admin, restaurant, and staff operations. Never prefix this variable with `VITE_`.
- `VITE_WEB_PUSH_PUBLIC_KEY` if staff notifications are enabled; `GEMINI_API_KEY` only if AI chat is enabled.

After deployment, open `https://<your-deployment>/api/health`; it must return JSON with `status: "ok"`, not the application's HTML or a 404. Then sign in with an admin account created in the **same Supabase project** using `npm run create:admin -- <username> <strong-password>` in a trusted local/server shell. Do not put the service-role key or admin password in the browser or a public Vercel variable. The internal username is converted to `<username>@accounts.novx.invalid`; a different Supabase project or an uncreated account will return incorrect credentials. If sign-in still fails, inspect the `/api/auth/login` response and Vercel function logs without sharing the password or secret keys.

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
