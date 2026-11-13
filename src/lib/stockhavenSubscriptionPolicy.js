/**
 * Luminous StockHaven — customer-facing WEBSITE subscription
 * policy for The Luminous Book Shop, LLC.
 *
 * Effective November 9, 2026. Website subscription billing is through
 * Stripe. You can cancel your
 * subscription yourself in the app using the Cancel Subscription button
 * in Settings or on the Upgrade page; cancellation and refund requests
 * can also be handled through the official customer support contact.
 *
 * Covers StockHaven website subscriptions, NOT bookstore item return
 * policies, eBay, Shopify, other marketplaces, or separately store-billed
 * Google Play / App Store subscriptions.
 *
 * This data powers the public policy route. Never infer that displaying
 * it starts billing, cancels a subscription or grants a refund.
 */
export const STOCKHAVEN_SUBSCRIPTION_POLICY = Object.freeze({
  id: 'stockhaven-website-subscription-cancellation-refunds',
  version: '2026-11-09-v5',
  status: 'effective',
  effectiveDate: 'November 9, 2026',
  lastReviewed: 'November 9, 2026',
  owner: 'The Luminous Book Shop, LLC',
  application: 'Luminous StockHaven',
  title: 'Subscription, Cancellation & Refund Policy',
  scope: 'This policy applies only to Luminous StockHaven website subscriptions purchased directly through our website. It does not govern physical bookstore products or purchases made through eBay, Shopify, Amazon, Walmart, TikTok Shop, Google Play, the Apple App Store, or other platforms. Those purchases may have separate terms.',
  introduction: 'Please review the subscription price, renewal schedule, any applicable taxes, and cancellation terms shown at checkout before authorizing a payment.',
  sections: Object.freeze([
    {
      id: 'plans', title: '1. Subscription plans',
      paragraphs: [
        'Luminous StockHaven provides inventory management software through monthly website subscription plans.',
        'Essentials costs $14.99 USD per month. Business costs $29.99 USD per month. Applicable taxes, where required, may be added and will be shown before checkout.',
        'Website subscriptions automatically renew monthly unless canceled before the next billing date. The actual amount and date are shown at checkout and in the billing confirmation.',
      ],
    },
    {
      id: 'trials', title: '2. Free trials',
      paragraphs: [
        'Eligible new customers may receive one seven-day trial when that offer is available during registration. Not every signup is guaranteed a free trial.',
        'Cancel the trial before its displayed deadline to avoid the first subscription charge. The checkout confirmation will show when a paid subscription starts.',
        'Changing between Essentials and Business, canceling, or returning to StockHaven does not start or restore another introductory trial.',
      ],
    },
    {
      id: 'cancel', title: '3. Canceling your subscription',
      paragraphs: [
        'You may cancel a Luminous StockHaven website subscription at any time using the Cancel Subscription button in Settings or on the Upgrade page, or through the official customer support contact shown in the application.',
        'A cancellation stops future automatic renewals once confirmed by the payment provider. A cancellation request alone does not guarantee that an already-processing charge has stopped; review the confirmation and effective date.',
        'Cancel at any time. If you have already paid for the current monthly billing period and do not request or receive a refund, your paid features will remain available until that period’s provider-confirmed paid-through date. No additional free month is added; the end date is the end of the month you already paid for.',
        'After your paid period ends, you have 15 days to view your products only — you can see SKUs, ISBNs, and everything you need to move elsewhere, but you cannot make changes, use the scanner, import, or export. After those 15 days, your account and all its information are permanently deleted and cannot be recovered. Resubscribing starts fresh.',
        'After the 15-day grace period ends, your account and all its information are permanently deleted and cannot be recovered.',
      ],
    },
    {
      id: 'refunds', title: '4. Refunds and billing errors',
      paragraphs: [
        'First paid subscription only: If you cancel within three days (72 hours) after the first successful paid Luminous StockHaven website subscription charge on your account, you may request a refund of that initial subscription payment. The three-day period begins when the first successful charge occurs, not when an eligible seven-day free trial begins.',
        'After this initial three-day window, voluntary subscription cancellations are nonrefundable. There are no ordinary partial refunds for unused days in a paid billing period. This introductory refund exception does not restart for monthly renewals, plan upgrades, resubscriptions, or a return to the service.',
        'When you cancel without a refund, you keep access through the paid-through date confirmed by the payment provider, and future renewals stop upon confirmed cancellation. If your initial subscription payment is refunded, paid subscription access may end when the refund is confirmed; refunding a payment does not provide a free additional month of paid service.',
        'We will correct confirmed billing errors and accidental duplicate charges, and honor refunds or other remedies required by applicable law. Nothing in this policy limits a customer’s statutory rights.',
        'To request an eligible first-payment refund, cancel within the three-day window and contact the official StockHaven support channel published in the app or at checkout. We will verify the original charge and the cancellation time before confirming the refund.',
      ],
    },
    {
      id: 'upgrades', title: '5. Changing subscription plans',
      paragraphs: [
        'Eligible website subscribers can request an Essentials-to-Business upgrade through their existing StockHaven customer account when plan changes are available.',
        'The revised subscription price, any applicable taxes, and the effective billing date will be presented before the customer confirms a change. If a proration applies, it must be disclosed before authorization.',
        'Changing plans does not create a second business workspace or restart an introductory trial. Existing inventory and business records remain associated with the original customer account.',
      ],
    },
    {
      id: 'failed-payments', title: '6. Failed payments',
      paragraphs: [
        'If a recurring payment is unsuccessful, we may notify you and provide an opportunity to update your payment method.',
        'Paid features may be restricted if payment remains outstanding, subject to the 15-day read-only grace period described in section 3 and applicable law. We will not treat an unverified payment as proof that paid services have renewed.',
      ],
    },
    {
      id: 'support', title: '7. Support and cancellation assistance',
      paragraphs: [
        'For subscription questions, cancellation assistance, duplicate charges, or refund requests, contact The Luminous Book Shop, LLC using the official Luminous StockHaven support contact published in the app or at checkout.',
        'Please do not submit card numbers, account passwords, or bank credentials in a support message.',
      ],
    },
    {
      id: 'updates', title: '8. Policy changes',
      paragraphs: [
        'We may update this policy as our services, billing processes, or legal requirements change. Material changes affecting recurring payment terms will be communicated as required by applicable law.',
      ],
    },
  ]),
});
