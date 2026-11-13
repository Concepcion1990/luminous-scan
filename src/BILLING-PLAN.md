# Luminous ScanHaven — customer subscription & billing build plan

Status: **plan only, nothing built.** Verified 2026-11-04: the app has no billing code,
no subscription records, and no payment provider connected.

## 1. What is being sold

One subscription per **business workspace**, paid by that workspace's owner.

- Price: **$14.99 / month**, per business, recurring.
- Free trial: **7 days** per new business workspace, no card required at signup.
- Staff seats: **included**, no per-seat charge. Staff never pay and never see amounts.
- A login that owns 2 businesses pays twice; each workspace has its own trial and its
  own state. Existing five-business cap stays as-is.

That matches how the app already works: every record is scoped to a `business_id`, the
owner is `Business.created_by_id`, and staff resolve by email through `StaffMember`.

## 2. Data model (new entities)

| Entity | Purpose | Key fields | Who reads / writes |
|---|---|---|---|
| `Subscription` | One row per business, the billing state | `business_id`, `owner_id`, `status` (trialing / active / past_due / expired / cancelled), `trial_ends_at`, `current_period_end`, `cancel_at_period_end`, `amount`, `currency`, `provider`, `provider_customer_id`, `provider_subscription_id`, `provider_price_id`, `grace_ends_at`, `grandfathered` | Owner + admin read/write; written by backend + webhook only |
| `BillingSettings` | The configurable plan (owner-scoped) | `plan_name`, `monthly_amount` (default 14.99), `currency`, `trial_days` (default 7), `grace_days` (default 7), `provider_price_id`, `active` | Admin only |
| `BillingEvent` | Audit trail + idempotency | `business_id`, `type`, `amount`, `provider_event_id` (unique), `note`, `created_at` | Admin read; written by webhook |

No card data is ever stored — only provider ids. `Business` gets two mirror fields,
`subscription_status` and `trial_ends_at`, so lists and the gate read one record instead
of joining.

## 3. Backend functions (4)

1. **`startCheckout`** — signed-in owner only. Refuses if the business is already
   subscribed. Creates the provider customer, the subscription with the 7-day trial, and
   returns a checkout URL. Trial state is recorded immediately so day-one access works
   even if the card is added later.
2. **`manageSubscription`** — reads live status and cancels (soft cancel by default, so
   access runs to the end of the paid period). Base44 Payments exposes Get and Cancel only:
   **there is no hosted customer portal**, so card updates and invoice history are not
   self-service — they live in the merchant dashboard (Dashboard → Overview → Payments →
   Manage). Corrected after reading the provider docs in Phase 0.
3. **`billingWebhook`** — the single source of truth. Verifies the signature, dedupes on
   `provider_event_id`, then handles: subscription created/updated/deleted, invoice paid,
   invoice payment failed, trial ending. Updates `Subscription`, mirrors onto `Business`,
   appends a `BillingEvent`, sends the matching email.
4. **`getBillingState`** — takes a `business_id` and returns only
   `{ status, days_left, grace, read_only }` — no amounts, no provider ids. This is how
   **staff** learn whether their workspace is current without being able to read billing
   details, which row-level security can't express as a join.

## 4. Screens (4 new pages, 1 new gate)

| Route | Page | Access |
|---|---|---|
| `/pricing` | Public marketing page: plan card, $14.99/month, 7-day trial, feature list, "Start free trial" → register, "Sign in" | Logged out |
| `/billing` | Current plan, trial countdown or next charge date, status banner, card on file (portal), invoices (portal), cancel / reactivate, and the price field for the owner-admin | Signed-in owner |
| `/subscriptions` | Customer billing console: every subscription, filter by status, trial counts, MRR, per-business notes, extend trial, comp a workspace, refund via provider, CSV export | App owner only (`role: admin` + owner check) |
| — | `BillingGate` wrapping `<Outlet />` in `Layout.jsx`, alongside the existing staff gate | Everyone |

Nav: **Billing** under Workspace (owner only, hidden for staff), **Subscriptions** under
Workspace for the app owner. Pricing page stays out of the app nav.

### Access states the gate produces

- **Trialing** — full access, amber banner "6 days left in your trial", upgrade CTA.
- **Active** — full access, no banner.
- **Past due** — full access during the grace window (7 days) with a red banner and a
  "Update payment" button. Staff see "Ask your owner to update billing."
- **Expired / cancelled** — **read-only**: every `*.manage` permission returns false, all
  create/edit/delete buttons are disabled, nav collapses to Overview, Products,
  Movements, Reports, Stock value, Exports; one "Reactivate" CTA. Nothing is deleted.

## 5. Item-by-item coverage

| Requested | Delivered by | Phase |
|---|---|---|
| 1. Pricing page | `/pricing` | 2 |
| 2. 7-day trial | `trial_days` in `BillingSettings`; stamped on first checkout/registration | 2 |
| 3. Configurable $14.99 | `BillingSettings.monthly_amount` + a provider price created from it | 1–2 |
| 4. Real payment processing | Provider connection (sandbox first, live keys later) + `startCheckout` | 0, 2 |
| 5. Automatic renewals | Provider-side recurring price; `billingWebhook` extends `current_period_end` on invoice paid | 3 |
| 6. Cancel & manage | `openBillingPortal`; cancel-at-period-end reflected by webhook | 4 |
| 7. Trial expiry & failed payments | Webhook + daily safety sweep workflow + 3 emails | 3 |
| 8. Restricted access | `BillingGate` read-only mode | 1, 3 |
| 9. Owner admin dashboard | `/subscriptions` | 5 |
| 10. Standalone site / Shopify | Provider-agnostic ids (`provider`, `provider_*_id`) + `getBillingState` as a read API, so a Shopify app or marketing site can check entitlement without touching the workspace. Actual Shopify code: out of scope. | 6 |

## 6. Phases

- **Phase 0 — connect the provider (needs your approval).** Install the payment
  integration, get a sandbox, confirm it supports recurring charges. Nothing user-facing.
- **Phase 1 — data + gate.** Three entities, `Subscription` resolution, `BillingGate` in
  read-only-off mode (`grandfathered`), `getBillingState`. Invisible: everyone stays on
  full access.
- **Phase 2 — pricing + trial.** `/pricing`, `startCheckout`, trial stamped, provider
  price created from `monthly_amount`.
- **Phase 3 — renewals, dunning, restriction.** Webhook, grace window, read-only mode
  switched on, daily sweep workflow, trial-ending / payment-failed / receipt emails.
- **Phase 4 — self-service.** `/billing` + portal: cancel, reactivate, update card.
- **Phase 5 — owner console.** `/subscriptions`: list, filter, MRR, extend trial, comp,
  refund, export.
- **Phase 6 — hardening + handoff.** Idempotency review, end-to-end test with the sandbox
  card, go-live checklist, `getBillingState` documented for the future Shopify app.

## 7. Honest limits to decide before Phase 3

1. **Read-only is enforced in the app, not by the database.** Row-level security cannot
   reference another entity, so a determined user calling the API directly with their own
   login could still write. Closing that means routing every inventory mutation through
   checked backend functions — a large refactor of ~15 flows. Recommendation: UI gate for
   v1 (they can only edit their own data), revisit before scale.
2. **Existing businesses.** Needs a decision: grandfather them free (`grandfathered: true`),
   or give them the 7-day trial at launch. Recommendation: grandfather, then convert
   manually from `/subscriptions`.
3. **Trial abuse.** A new login can create a second business for a second trial. Minimal
   guard: one trial per `created_by_id`, tracked on the user record.
4. **Tax and invoices** are the provider's, not ours. No VAT engine, no custom PDFs.

## 8. Decisions locked (2026-11-04)

1. **$14.99 per business, per month.** Each workspace bills separately.
2. **One trial per owner, ever** — not per business. A second workspace created by the
   same login starts straight on the paid plan; the trial flag lives on the owner, so this
   needs one field on the User record (`trial_used_at`) in addition to the subscription.
3. **Read-only on expiry**, never a lockout: data stays visible, writes stop.
4. **Existing businesses are grandfathered** — `grandfathered: true`, full access, no
   charge, converted by hand from `/subscriptions` when you decide to.
5. **7-day grace** on a failed payment, then read-only.

## 10. Phase 0 outcome (2026-11-04, complete — superseded 2026-11-08)

- **Stripe is the planned payment provider.** Wix / Base44 Payments were
  removed on 2026-11-08; Stripe Checkout is not yet connected and no
  `STRIPE_*` credentials are configured yet. Subscriptions are paused
  while payments switch to Stripe.
- **Webhook (planned):** a Stripe webhook will confirm checkout and
  subscription events before any access is granted. The old Wix webhook
  (`payments-webhook` for `order_approved`,
  `subscription_contract_canceled` and `subscription_contract_expired`)
  is retired with the Wix removal.
- **Scaffold inspected.** `create-checkout` resolves price from a server-owned catalog that is
  still **empty**, so nothing is sellable yet. `payments-webhook` verifies the JWT, correlates
  by checkout id, validates the amount/currency exactly, confirms a free-trial subscription is
  ACTIVE before granting, and tracks `lastCycleNumber` for renewals — with both
  `// ===== APP-SPECIFIC =====` blocks empty, so a payment would be recorded but grant nothing.
  (Historical note: this described the retired Wix implementation.)
- **Subscriptions supported by the provider:** `frequency: "MONTH"`, `autoRenewal` default true,
  `freeTrialPeriod` on the line item. Because the trial is once-per-owner, the catalog needs two
  server-owned products: monthly **with** 7-day trial, and monthly **without**.
  (Historical note: this described the retired Wix product shape; the Stripe
  catalog must be defined fresh.)
- **No sandbox.** The provider documents no test mode: an end-to-end test means publishing and
  taking a real charge (refundable from the dashboard). Everything up to the redirect can be
  tested without paying.
  (Historical note: this described the retired Wix provider; Stripe test mode
  must be confirmed as part of the Stripe build.)
- **ThankYou route exists** (`/ThankYou`), so the return URL is valid.

## 9. Out of scope for v1

Annual plans, multiple tiers, per-seat pricing, usage metering, coupon codes, affiliate
programme, Shopify app implementation, customer-facing invoice PDFs.