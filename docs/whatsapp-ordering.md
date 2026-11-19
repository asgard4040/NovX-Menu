# WhatsApp AI ordering setup

## Gupshup Self-Serve

For delivery-first ordering, follow [delivery setup](whatsapp-delivery-ordering.md).
Owners configure and enable real delivery areas and fees in WhatsApp AI settings.
No delivery charges or coverage are inferred. Existing pickup ordering remains
available when explicitly selected or delivery is not enabled.

1. In ORDOVA's restaurant owner **WhatsApp AI** section, choose **Connect WhatsApp manually → Gupshup Self-Serve**. An ORDOVA admin can use **Restaurants → WhatsApp connection**. Disconnect an existing Meta connection before switching providers.
2. From the restaurant's Gupshup app **Settings**, enter **App Name**, **App ID**, **API Key**, and the registered **sender number** with country code, digits only (for example `9647…`). Submit secrets only in this authenticated form. ORDOVA checks API-key access through Gupshup's [Get Business Details](https://docs.gupshup.io/reference/get-business-details) endpoint and encrypts the key. Confirm the sender number and app name exactly match the Gupshup app; this access check does not verify the sender's live delivery or billing state.
3. Select **Copy callback URL**. The production endpoint is `https://rest.ordova.cc/api/whatsapp/gupshup/webhook`. The full per-restaurant URL adds `connection` and a private `token`. Copy the entire generated URL, including its query string. Never use the bare endpoint, remove its token, paste it into chat, or expose it in public logs.
4. In [Gupshup's dashboard](https://www.gupshup.io/whatsapp/dashboard), open the matching app **Overview → Webhooks**. Add the full callback URL, select **callback version 2**, activate it, and enable incoming **MESSAGE** events plus **SENT**, **DELIVERED**, **READ**, and **OTHERS**. Leave **ENQUEUED** and **FAILED** enabled. If the dashboard offers **ALL** events, that is also supported. Avoid adding duplicate ORDOVA webhook subscriptions. See [Set Callback URL](https://docs.gupshup.io/docs/set-webhookcallback-url) and [Webhooks](https://docs.gupshup.io/docs/webhooks-2).
5. ORDOVA acknowledges authenticated connectivity checks and other system events with an empty HTTP 200. Messages are durably queued before acknowledgment; AI processing and sends happen in the existing worker. **Awaiting first authenticated event** means API access was verified but the callback has not arrived. **Check connection** rechecks API access and does not prove live message delivery.
6. Enable the assistant and pickup ordering in ORDOVA. From another WhatsApp phone, send `السلام عليكم، أريد أشوف المنيو`, choose an available item, change a quantity or modifier, choose pickup, and confirm the quote using its button or confirmation code. Verify exactly one pending order appears in the normal waiter dashboard. Approve it and mark it ready through the normal staff workflow; the same chat should receive status updates. Only customer messages open or extend the 24-hour window; delivery and system events do not.
7. **Replace credentials** accepts a new key for the same app and number, rotates the callback token, and requires updating the callback URL in Gupshup. Old callback tokens stop working immediately. Disconnect before changing app identity or sender number. **Disconnect** deletes the encrypted API key and callback credential locally and stops sending and ingestion; also remove the webhook in Gupshup. It does not delete the Gupshup app or revoke an account-wide key used elsewhere.

Security: the documented Self-Serve callback API does not specify a cryptographic request signature. This integration authenticates possession of a separate random 256-bit bearer token over HTTPS before accepting any app or message data; the app name never selects a restaurant. Tokens are encrypted per tenant and credential replacements are checked atomically during ingestion. The full callback URL is a credential, so restrict access to request URL logs. Gupshup also [recommends source-IP allowlisting](https://docs.gupshup.io/docs/what-is-a-webhook); request the current webhook egress IPs from Gupshup support and configure a Vercel Firewall allowlist for this endpoint. No undocumented Gupshup HMAC header is assumed.

Outgoing session replies use Gupshup's official [text](https://docs.gupshup.io/reference/session-text-message) and [quick-reply](https://docs.gupshup.io/reference/quick-replies) APIs. V2 inbound messages also support `sender.phone` when `source` is absent. For [BSUID-only customers](https://support.gupshup.io/hc/en-us/articles/55873677826713-Username-Business-Scoped-User-ID), ORDOVA reuses its existing customer-ID support and sends the Cloud-style message through Gupshup's `/wa/app/{appId}/v3/msg` API with the server-side API key. The app must have the corresponding BSUID webhook and V3 messaging access enabled in Gupshup; ORDOVA does not change those account permissions. Gupshup message IDs reconcile [delivery events](https://docs.gupshup.io/docs/message-events). Uncertain sends are not blindly retried. Meta service-window, account eligibility, billing and Gupshup wallet restrictions still apply. A sandbox app requires Gupshup's allowed test-recipient setup. No marketing or out-of-window templates are sent.

Apply [the Gupshup migration](../supabase/migrations/202611180001_whatsapp_gupshup.sql) after the existing WhatsApp and manual-onboarding migrations. It adds provider-specific account fields and service-only RPCs, preserves RLS, and reuses the existing conversations, queue, order writer, waiter/kitchen workflow and status triggers. Gupshup app routing keys are namespaced internal account keys, not Meta phone/WABA IDs. No new provider-wide environment secret is needed. Existing credential encryption, OpenAI and worker settings remain required.

## Manual Meta setup

1. The restaurant creates or uses its own Meta Business Portfolio and developer app with the WhatsApp use case. Add its WhatsApp Business Account and register its Cloud API number in Meta. For a sandbox test, use the Meta test number under **WhatsApp → API Testing** and add and verify your recipient number there. [Meta Cloud API setup](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started)
2. In the restaurant owner's **WhatsApp AI** panel, open **Connect WhatsApp manually**. An ORDOVA admin can open the same connection form under **Restaurants → WhatsApp connection** on the restaurant's card.
3. In the restaurant's Meta app, choose the **WhatsApp Business Account** webhook object. Paste the callback URL and tenant-specific verify token from ORDOVA, save, then subscribe to **messages**. Treat the verification token as a secret. [Meta webhook reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview)
4. Enter the **Phone Number ID**, **WhatsApp Business Account ID**, **Meta App ID**, **App Secret**, and an access token issued by that same app. For production, use a system-user token authorized for this account with `whatsapp_business_management` and `whatsapp_business_messaging`. A temporary Meta test token expires and may require replacement. Keep the token and App Secret in the ORDOVA form and your secret manager.
5. Select **Verify and save**. ORDOVA checks the app token and registered phone, verifies or adds the app's WABA subscription, and encrypts the token and App Secret. Enable the assistant and pickup orders. Send a message from the allowed test phone, check **Last WhatsApp event**, confirm a pickup order, and look for it in the waiter dashboard.
6. Use **Check connection** to recheck Meta access and the app's WABA subscription. Use **Replace credentials** to rotate credentials for the same app and number. Disconnect first when changing the app or number. Disconnect clears the ORDOVA credentials. If Meta cannot confirm unsubscription, remove the ORDOVA webhook or app subscription in Meta.

This path uses the restaurant's own Meta app and does not depend on ORDOVA's Tech Provider approval. Meta still controls token permissions, asset access, phone eligibility, verification, billing, and production messaging limits. The Meta sandbox is for allowed test recipients.

## Optional Embedded Signup

Manual connection is the default. To re-enable Embedded Signup, set `WHATSAPP_EMBEDDED_SIGNUP_ENABLED=true` and complete the following steps.

1. Create a Meta app with the WhatsApp use case and complete the Tech Provider setup, including business verification and App Review for Advanced Access to `whatsapp_business_management` and `whatsapp_business_messaging`. Use the app's Live mode for restaurants outside its test roles. [Meta Tech Provider setup](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers)
2. In Facebook Login for Business, create a WhatsApp Embedded Signup configuration for WhatsApp Messaging and copy its ID. Add the ORDOVA owner dashboard's HTTPS origin to Allowed Domains and Valid OAuth Redirect URIs, and enable the JavaScript SDK and the OAuth settings required for Embedded Signup. ORDOVA uses Embedded Signup v5. [Meta implementation guide](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation) · [Embedded Signup v5](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-5)
3. Set the WhatsApp webhook callback to `https://<ordova-host>/api/whatsapp/webhook`. Use the same verification token as `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, and subscribe the app to `messages` and `account_update`. ORDOVA subscribes to each restaurant's Messaging account during signup. [Meta webhook reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview)
4. As the restaurant owner, open **WhatsApp AI**, select **Connect WhatsApp**, and complete Meta's signup flow with an eligible number. Meta may require verification by SMS or voice, display-name approval, and a billing setup. Set the six-digit Cloud API registration PIN in ORDOVA when registering a new number. Eligible WhatsApp Business app numbers can use Meta's coexistence flow. Enable the AI and pickup ordering in the owner dashboard after connection. [Meta coexistence guide](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)

## Server environment

Use the WhatsApp entries in [the environment example](../.env.example). These are server settings.

- Set `WHATSAPP_META_APP_ID`, `WHATSAPP_META_APP_SECRET`, `WHATSAPP_META_SIGNUP_CONFIG_ID`, and `WHATSAPP_WEBHOOK_VERIFY_TOKEN` only for Embedded Signup or existing connections that use ORDOVA's Meta app. Graph API defaults to `v27.0`. Set `WHATSAPP_WEBHOOK_ORIGIN` to the public HTTPS origin when testing on a separate staging environment.
- Generate a stable encryption key with `node -p "require('node:crypto').randomBytes(32).toString('base64url')"` and save it as `WHATSAPP_CREDENTIAL_KEY`. Generate a separate random value for `WHATSAPP_WORKER_SECRET`. Store both in the server secret manager. Replacing the encryption key requires reconnecting existing WhatsApp numbers.
- Set `WHATSAPP_OPENAI_API_KEY` to a billed OpenAI project key with access to `gpt-6-luna`. The app can also use its existing `OPENAI_API_KEY`. `WHATSAPP_OPENAI_MODEL` selects a different Responses API model with strict function calling. Token counts work with either key. Set both optional USD-per-million-token rates in the environment to display cost estimates. [OpenAI model reference](https://developers.openai.com/api/docs/models/gpt-6-luna)
- Use the existing ORDOVA server-side `SUPABASE_SERVICE_ROLE_KEY`.

## Supabase worker

Apply [the WhatsApp migration](../supabase/migrations/20261116141744_whatsapp_ordering.sql) and [the manual onboarding migration](../supabase/migrations/202611170001_whatsapp_manual_onboarding.sql) before deploying the application. Enable `pg_cron` and `pg_net` in Supabase and create these secrets in Vault via the dashboard.

| Vault secret name | Value |
| --- | --- |
| `ordova_whatsapp_worker_url` | `https://<ordova-host>/api/whatsapp/worker` |
| `ordova_whatsapp_worker_secret` | Same value as `WHATSAPP_WORKER_SECRET` on the application server |

Run the following in the target Supabase SQL editor as the database administrator, after setting the secrets. The first job calls the worker only when messages are due. The second expires interrupted connections and prunes old conversation content.

```sql
select cron.schedule('ordova-whatsapp-worker', '10 seconds',
  $$select public.whatsapp_dispatch_due();$$);
select cron.schedule('ordova-whatsapp-prune', '17 2 * * *',
  $$select public.whatsapp_prune();$$);
```

Reference links are [Supabase Cron](https://supabase.com/docs/guides/cron), [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net), and [Vault](https://supabase.com/docs/guides/database/vault).

## Verify

1. Run `npm run test:whatsapp`. The tests use an in-process PostgreSQL database and mocked Meta, OpenAI, and Supabase HTTP services.
2. In a configured test environment, send an Iraqi Arabic or English text to the connected number. Add an item, change a quantity or modifier, choose pickup, and confirm the final quote using its button or confirmation code. The waiter dashboard should show a single pending order.
3. Approve the order and mark it ready from the kitchen. Check for the corresponding WhatsApp updates. Repeat with a second order and decline it from the waiter dashboard.
4. Service replies and updates use the 24-hour window from the customer's most recent incoming message. The worker records blocked messages in the owner dashboard when that window has closed. [Meta service-message rules](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages)

WhatsApp orders use pickup. Customers can change or cancel their draft in chat. Change and cancellation requests for submitted orders go to restaurant staff when owner handoff is enabled. The dashboard history starts with messages ORDOVA processes after connection.

The daily cleanup removes message content after 30 days and removes inactive conversations and usage records after 90 days. ORDOVA orders are retained under the existing order workflow.
