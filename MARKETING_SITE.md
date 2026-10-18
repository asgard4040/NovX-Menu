# ORDOVA marketing website

The public marketing page is served at `/`. The existing staff application is at `/app`. Table QR links using `?restaurantId=...` and restaurant-specific staff links using `?loginRestaurantId=...` continue to open the existing product interfaces.

Marketing copy, phone/WhatsApp destination, social links, testimonials, FAQ answers, and screenshot inventory are maintained in [`src/marketing/content.ts`](src/marketing/content.ts). The public site components and styles are in `src/marketing/`.

## Product screenshots

The repository did not contain exported interface screenshots. The marketing gallery therefore labels each missing capture and lists recommended dimensions. It intentionally shows no fabricated product UI. To replace a slot:

1. Capture the matching screen from a demonstration restaurant in the running application.
2. Remove customer names, phone numbers, staff credentials, private restaurant information, and secrets. Use demonstration menu items and accounts.
3. Save an optimized PNG or WebP under `public/marketing/screenshots/`. Keep native proportions and check that text remains readable.
4. Add its path under `marketingConfig.screenshotSources` in `src/marketing/content.ts`, using the slot ID shown in the screenshot inventory. For example, `'menu-ar': '/marketing/screenshots/menu-ar.webp'`.
5. Check the customer, manager, waiter, and kitchen gallery tabs and lightbox at mobile and desktop sizes.

## Contact flow

The demo form validates entries and prepares a WhatsApp message. The visitor reviews and sends the message in WhatsApp. The website does not store form submissions. Update the destination number in `marketingConfig` if the support contact changes.

## Before production launch

- Add verified product screenshots and approved customer testimonials when available.
- Set `marketingConfig.canonicalUrl` to the final public URL, and use the same absolute URL for Open Graph image metadata.
- Add verified social account URLs to `marketingConfig.socialLinks`.
- Review the privacy and service terms text with the ORDOVA team.

The two hospitality photographs are AI-generated marketing imagery. Product interface screenshots remain separate and must come from the actual application.
