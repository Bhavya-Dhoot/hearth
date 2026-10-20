# Hearth Privacy Policy

Effective 2026-10-21. Applies to the Hearth Alexa+ add-on, its MCP server, and the simulated Alexa+ host that ships with it.

We are not a law firm and this is a plain-language policy for a hackathon add-on, not legal advice; have counsel review it before any commercial launch.

## 1. The short version

- Hearth remembers things about your home so it can help when something breaks. That is the whole product.
- We keep your city and state, not your street address.
- We do not collect health data. We do not collect data about children, and Hearth is not directed at children.
- We do not sell your data and we do not use it for advertising.
- Payments in this build are simulated or run in Stripe test mode. No real money moves and no real card number is stored.
- You can ask us to delete everything, any time, at support@hearth.example.

## 2. What we collect

This list matches what the Hearth data model can actually hold. If it is not here, Hearth has nowhere to put it.

| What | Where it comes from | Details |
|---|---|---|
| Account identifier (`userId`) | Account linking | When you link Hearth to Alexa, our auth server issues a token whose subject is your `userId`. It is the only key that ties your requests to your home. |
| Sign-in details | You, when you link your account | The auth server holds the name and email on your Hearth sign-in, and a salted password hash (never the password). The email is used for order confirmations and support. These sit with the sign-in service, not in the home record. |
| Home | You | A home name you choose, city, state, year built, climate zone, time zone, and optionally number of baths and heating fuel. No street address, no postal code, no coordinates. |
| Things in your home ("assets") | You, by voice or photo | Appliances, fixtures, shut-off valves, electrical panel, HVAC, consumables: label, brand, model, serial, install date, the room and a short note about where it is, attributes such as pipe or filter sizes, replacement intervals, and any recall ids matched to it. |
| Photos you add | You | The photo of a label or a valve, a short description, and where on the photo you circled. Photos are linked to the item they show and can appear in repair steps and in pro briefs you create. Do not photograph people. |
| Issues | You | The problem as you described it, your answers to our questions, which repair playbook applied, and how far you got. |
| Timeline events and tasks | You and Hearth | Repairs, maintenance, orders, escalations and added items, with a summary, optional cost and photos; upcoming tasks such as "replace the furnace filter". |
| Pro briefs | You, on request | The brief we assemble for a professional (see section 5), with a share link token. |
| Orders | You, when you buy | Item (SKU), quantity, totals, status, arrival date, order number, checkout session id, and the payment processor's reference id. The payment method is stored only as a display label such as "Visa ending 4242". Hearth never sees or stores a full card number. |
| Idempotency records | Hearth | A short key and the result of a write, so a retry never creates a duplicate order or note. |
| Technical logs | Hearth | Request timing, error codes, and tool names so we can keep the service fast and safe. Logs are not meant to hold the content of what you said; we do not log spoken audio. |

We do not collect: street address, precise location, health or medical information, information about children, financial account or bank details, government identifiers, contacts, or anything from your other Alexa skills.

## 3. What Alexa and Amazon see

Alexa+ handles your voice and decides when to call Hearth. Amazon's own privacy notice governs that. Hearth only receives what Alexa passes in a tool call (for example "my P-trap leaks") plus your `userId` from account linking. Hearth does not receive your audio. In this hackathon build, the Alexa+ device is a web-page simulation that acts as a real MCP client; it is clearly labelled, and no real Alexa device data is involved.

## 4. How we use it

- To answer you: personalise repair steps, find parts that fit what you own, and remember what was done.
- To finish what you ask: place an order you confirmed, send your confirmation email, build a pro brief.
- To keep Hearth safe and working: check for abuse, fix bugs, measure speed.
- We do not train models on your home data, do not sell it, and do not use it for advertising or profiling.

## 5. Pro briefs and sharing

A pro brief is a summary page for a plumber, electrician, HVAC tech or appliance repairer. It contains the item's brand, model and age, your symptom description, a short timeline, what you already tried, access notes, and the photos you chose. It does not contain your name or street address, but the access notes are text you or Alexa wrote, so say nothing in them you do not want a pro to see.

A brief is reachable by a link containing a long random token. Anyone who has the link can open it, so share it only with the pro you choose. Briefs are not indexed. Hearth does not send briefs to anyone on its own, and does not pass them to a service provider. To have a brief removed, email support.

## 6. Who processes data for us

| Processor | Used for | Notes |
|---|---|---|
| Amazon Web Services | Hosting the servers, the DynamoDB table that holds the Home Graph, the Bedrock model that powers the assistant (with Bedrock Guardrails) | Data is stored in the AWS region the stack is deployed to. We do not use it to train models. |
| Stripe (test mode) | Payment processing for orders | Test mode only: the card is Stripe's published test card, no real charge is made, and Hearth stores only Stripe's reference id and a display label. |
| Resend | Sending order confirmation emails | Receives your email address and the confirmation text. When Resend is not configured, the email is written to a local outbox instead and no third party receives it. |

We do not use advertising, analytics or tracking vendors.

## 7. What is simulated in this build

Being plain about it:

- The Alexa+ device is a web-page simulation (a real MCP client), not an Amazon device.
- Payments are Stripe test mode or fully simulated. When Stripe is not configured, the order record says `simulated` and no payment provider is contacted.
- The recall data is a labelled sample, not a live Consumer Product Safety Commission feed.
- The parts catalogue is a seeded demo catalogue; orders are not fulfilled and nothing ships.
- The demo home, "The Okafor House", and the demo user are fictional.
- Photos shown in the demo are line illustrations.

## 8. Retention

- Home Graph data (home, things, issues, events, tasks, briefs, orders): kept while your account is linked and until you ask us to delete it.
- Refresh tokens: 30 days, rotated every time you use one; access tokens last 1 hour.
- Checkout sessions: expire after 30 minutes; the record stays with its order if one was placed.
- Logs: kept up to 30 days.
- After a deletion request we remove your data from the live database within 30 days. Any backups roll off on their normal cycle after that. Records we must keep for legal or tax reasons (for example an order record for a real purchase) are kept only as long as required. In this test build there are no real purchases.

## 9. Your choices and rights

- Ask what we hold about you, ask for a copy, correct it, or delete it: support@hearth.example. We reply within 30 days.
- You can tell Alexa to forget a specific item ("remove my water heater"), or revoke Hearth's access from your Alexa account at any time; after revoking, Hearth can no longer read or write your home until you link again.
- If you live somewhere with a privacy law that gives you more rights (for example California), those rights apply and we will honour them. We do not sell or share personal information for cross-context advertising.

## 10. Children

Hearth is for adults managing a household. It is not directed at children, we do not knowingly collect data from or about children, and the assistant is built to refuse requests to store children's details or to have a child do a repair. If you believe a child's data has been stored, write to support@hearth.example and we will delete it.

## 11. Security

Public endpoints are served over HTTPS (local development uses plain HTTP on localhost only). Access to the API requires an OAuth 2.1 token (PKCE, RS256, 1 hour). Passwords are stored only as salted hashes. Each request is limited to the home of the `userId` in the token. No system is perfectly secure; if we learn of a breach affecting you, we will tell you promptly.

## 12. Changes and contact

If we change this policy in a way that matters, we will update the date at the top and tell linked users by email. Questions, requests or complaints: support@hearth.example.
