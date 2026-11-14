/**
 * Mock Stripe — T4 test double.
 *
 * Implements the SAME HTTP call shapes the real Stripe API has
 * (POST /v1/checkout/sessions, GET/POST /v1/subscriptions/:id,
 * GET /v1/customers?email=, GET /v1/invoices, ...), with in-memory
 * state, so every billing test runs against the real Express routes
 * without a test key, a live key, or a real charge. The mock is
 * installed as the Stripe transport via __setStripeFetch.
 *
 * Amounts: Essentials $14.99 (1499¢), Business $29.99 (2999¢).
 * Test Price IDs come from the env vars the harness sets
 * (STRIPE_TEST_PRICE_ESSENTIALS / _BUSINESS) — never invented here.
 * Time is real time: a trial ends now + 7 days, a paid period ends
 * now + 30 days. advancePeriod() simulates a renewal.
 *
 * This mock NEVER touches live Stripe and NEVER charges a real card.
 */
import crypto from 'node:crypto';

const AMOUNTS_CENTS = { essentials: 1499, business: 2999 };

export function createMockStripe() {
  let seq = 0;
  let invoiceSeq = 0;
  const customersByEmail = new Map();
  const customersById = new Map();
  const subscriptions = new Map();
  const sessions = new Map();
  const invoices = new Map();
  const charges = new Map();
  let lastCheckoutParams = null;

  const nowSec = () => Math.floor(Date.now() / 1000);
  const nextId = (prefix) => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
  const nextInvoiceNumber = () => String(++invoiceSeq).padStart(8, '0');

  function pricePlan(priceId) {
    if (priceId === process.env.STRIPE_TEST_PRICE_ESSENTIALS) return 'essentials';
    if (priceId === process.env.STRIPE_TEST_PRICE_BUSINESS) return 'business';
    if (priceId === 'price_1UZatSQ5knDt27cX7ggcUR6k') return 'essentials';
    if (priceId === 'price_1UZatvQ5knDt27cXQ7yip3cU') return 'business';
    return null;
  }

  function findOrCreateCustomer(email) {
    const normalized = String(email || '').trim().toLowerCase();
    if (customersByEmail.has(normalized)) return customersByEmail.get(normalized);
    const customer = { id: nextId('cus'), email: normalized, object: 'customer' };
    customersByEmail.set(normalized, customer);
    customersById.set(customer.id, customer);
    return customer;
  }

  function createInvoice(sub, billingReason, amountPaid) {
    const invoice = {
      id: nextId('in'),
      object: 'invoice',
      number: nextInvoiceNumber(),
      subscription: sub.id,
      customer: sub.customer,
      billing_reason: billingReason,
      amount_paid: amountPaid,
      amount_due: 0,
      currency: 'usd',
      status: 'paid',
      created: nowSec(),
    };
    invoices.set(invoice.id, invoice);
    return invoice;
  }

  function createSubscription({ customer, priceId, trial, metadata }) {
    const plan = pricePlan(priceId);
    const trialEnd = trial ? nowSec() + 7 * 24 * 60 * 60 : null;
    const sub = {
      id: nextId('sub'),
      object: 'subscription',
      customer: customer.id,
      status: trial ? 'trialing' : 'active',
      trial_end: trialEnd,
      current_period_end: trial ? trialEnd : nowSec() + 30 * 24 * 60 * 60,
      cancel_at_period_end: false,
      items: { data: [{ id: nextId('si'), price: { id: priceId }, plan: { id: priceId } }] },
      metadata: { ...(metadata || {}) },
      created: nowSec(),
    };
    subscriptions.set(sub.id, sub);
    createInvoice(sub, 'subscription_create', trial ? 0 : AMOUNTS_CENTS[plan] || 0);
    return sub;
  }

  function jsonResponse(status, body) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  }

  function stripeError(status, message, code = 'invalid_request_error') {
    return jsonResponse(status, { error: { message, type: 'invalid_request_error', code } });
  }

  async function mockFetch(url, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\/v1/, '');
    const params = new URLSearchParams(
      method === 'GET' ? parsed.search.slice(1) : String(options.body || ''),
    );
    const get = (key) => params.get(key);

    // POST /v1/checkout/sessions
    if (method === 'POST' && path === '/checkout/sessions') {
      lastCheckoutParams = Object.fromEntries(params.entries());
      const mode = get('mode');
      const email = get('customer_email') || 'customer@example.com';
      const customer = findOrCreateCustomer(email);
      const metadata = {};
      for (const [key, value] of params.entries()) {
        const m = key.match(/^metadata\[(.+)\]$/);
        if (m) metadata[m[1]] = value;
      }
      const session = {
        id: nextId('cs'),
        object: 'checkout.session',
        mode,
        url: `https://checkout.stripe.com/pay/${nextId('sess')}`,
        customer: customer.id,
        customer_email: email,
        payment_status: 'paid',
        metadata,
        client_reference_id: get('client_reference_id'),
        success_url: get('success_url'),
        cancel_url: get('cancel_url'),
      };
      if (mode === 'subscription') {
        const priceId = get('line_items[0][price]');
        const trialDays = Number.parseInt(get('subscription_data[trial_period_days]') || '0', 10);
        const subMetadata = {};
        for (const [key, value] of params.entries()) {
          const m = key.match(/^subscription_data\[metadata\]\[(.+)\]$/);
          if (m) subMetadata[m[1]] = value;
        }
        const sub = createSubscription({
          customer,
          priceId,
          trial: trialDays > 0,
          metadata: { ...metadata, ...subMetadata },
        });
        session.subscription = sub.id;
      }
      sessions.set(session.id, session);
      return jsonResponse(200, session);
    }

    // GET /v1/checkout/sessions/:id
    const sessionMatch = path.match(/^\/checkout\/sessions\/([^/]+)$/);
    if (method === 'GET' && sessionMatch) {
      const session = sessions.get(decodeURIComponent(sessionMatch[1]));
      if (!session) return stripeError(404, 'No such checkout session.');
      const out = { ...session };
      if (parsed.search.includes('expand')) {
        const sub = subscriptions.get(session.subscription);
        if (sub) out.subscription = { ...sub };
      }
      return jsonResponse(200, out);
    }

    // GET /v1/subscriptions/:id
    const subGet = path.match(/^\/subscriptions\/([^/]+)$/);
    if (method === 'GET' && subGet) {
      const sub = subscriptions.get(decodeURIComponent(subGet[1]));
      if (!sub) return stripeError(404, 'No such subscription.');
      return jsonResponse(200, { ...sub });
    }

    // POST /v1/subscriptions/:id
    if (method === 'POST' && subGet) {
      const sub = subscriptions.get(decodeURIComponent(subGet[1]));
      if (!sub) return stripeError(404, 'No such subscription.');
      const newPrice = get('items[0][price]');
      if (newPrice) {
        sub.items.data[0].price = { id: newPrice };
        sub.items.data[0].plan = { id: newPrice };
      }
      const trialEnd = get('trial_end');
      if (trialEnd !== null && trialEnd !== undefined) sub.trial_end = Number(trialEnd);
      const cancelAtPeriodEnd = get('cancel_at_period_end');
      if (cancelAtPeriodEnd !== null && cancelAtPeriodEnd !== undefined) {
        sub.cancel_at_period_end = cancelAtPeriodEnd === 'true';
      }
      return jsonResponse(200, { ...sub });
    }

    // GET /v1/subscriptions?customer=
    if (method === 'GET' && path === '/subscriptions') {
      const customerId = get('customer');
      const data = [...subscriptions.values()].filter((sub) => sub.customer === customerId);
      return jsonResponse(200, { object: 'list', data });
    }

    // GET /v1/customers?email=
    if (method === 'GET' && path === '/customers') {
      const email = String(get('email') || '').trim().toLowerCase();
      const customer = customersByEmail.get(email);
      return jsonResponse(200, { object: 'list', data: customer ? [customer] : [] });
    }

    // GET /v1/invoices?subscription=
    if (method === 'GET' && path === '/invoices') {
      const subId = get('subscription');
      const data = [...invoices.values()].filter((inv) => inv.subscription === subId);
      return jsonResponse(200, { object: 'list', data });
    }

    // GET /v1/invoices/:id
    const invGet = path.match(/^\/invoices\/([^/]+)$/);
    if (method === 'GET' && invGet) {
      const invoice = invoices.get(decodeURIComponent(invGet[1]));
      if (!invoice) return stripeError(404, 'No such invoice.');
      return jsonResponse(200, { ...invoice });
    }

    // POST /v1/refunds
    if (method === 'POST' && path === '/refunds') {
      const chargeId = get('charge');
      const refund = { id: nextId('re'), object: 'refund', charge: chargeId, amount: Number(get('amount') || 0), status: 'succeeded' };
      const charge = charges.get(chargeId);
      if (charge) charge.refunded = true;
      return jsonResponse(200, refund);
    }

    return stripeError(404, `Mock Stripe has no route for ${method} ${path}.`);
  }

  /** Simulate a renewal: new cycle invoice, period extended 30 days. */
  function advancePeriod(subId) {
    const sub = subscriptions.get(subId);
    if (!sub) throw new Error(`mock: no subscription ${subId}`);
    sub.status = 'active';
    sub.trial_end = null;
    sub.current_period_end = sub.current_period_end + 30 * 24 * 60 * 60;
    sub.cancel_at_period_end = false;
    const plan = pricePlan(sub.items.data[0].price.id);
    const invoice = createInvoice(sub, 'subscription_cycle', AMOUNTS_CENTS[plan] || 0);
    return { sub: { ...sub }, invoice: { ...invoice } };
  }

  /** Simulate a failed payment: subscription goes past_due. */
  function failPayment(subId) {
    const sub = subscriptions.get(subId);
    if (!sub) throw new Error(`mock: no subscription ${subId}`);
    sub.status = 'past_due';
    const invoice = {
      id: nextId('in'),
      object: 'invoice',
      number: nextInvoiceNumber(),
      subscription: sub.id,
      customer: sub.customer,
      billing_reason: 'subscription_cycle',
      amount_paid: 0,
      amount_due: 2999,
      currency: 'usd',
      status: 'open',
      created: nowSec(),
    };
    invoices.set(invoice.id, invoice);
    return { sub: { ...sub }, invoice: { ...invoice } };
  }

  /** Simulate a refunded first charge: returns a charge object for the webhook. */
  function refundFirstCharge(subId) {
    const sub = subscriptions.get(subId);
    if (!sub) throw new Error(`mock: no subscription ${subId}`);
    const first = [...invoices.values()]
      .filter((inv) => inv.subscription === subId && inv.billing_reason === 'subscription_create' && inv.amount_paid > 0)
      .sort((a, b) => a.created - b.created)[0];
    if (!first) throw new Error('mock: no paid first charge to refund');
    const charge = { id: nextId('ch'), object: 'charge', invoice: first.id, amount: first.amount_paid, refunded: true };
    charges.set(charge.id, charge);
    return { ...charge };
  }

  /** Rewrite a stored invoice into Stripe's current shape
   *  (API 2026-10-28.endive): no top-level subscription — the link
   *  lives at parent.subscription_details.subscription, with the
   *  subscription's metadata mirrored there. Returns the new shape. */
  function reshapeInvoiceNewApi(invoiceId) {
    const invoice = invoices.get(invoiceId);
    if (!invoice) throw new Error(`mock: no invoice ${invoiceId}`);
    const sub = subscriptions.get(invoice.subscription);
    invoice.parent = {
      type: 'subscription_details',
      subscription_details: {
        subscription: invoice.subscription,
        metadata: { ...(sub ? sub.metadata : {}) },
      },
    };
    invoice.subscription = null;
    return { ...invoice };
  }

  function getSubscription(subId) {
    const sub = subscriptions.get(subId);
    return sub ? { ...sub } : null;
  }

  function getSession(sessionId) {
    const session = sessions.get(sessionId);
    return session ? { ...session } : null;
  }

  function listInvoices(subId) {
    return [...invoices.values()].filter((inv) => inv.subscription === subId);
  }

  function getLastCheckoutParams() {
    return lastCheckoutParams ? { ...lastCheckoutParams } : null;
  }

  function reset() {
    customersByEmail.clear();
    customersById.clear();
    subscriptions.clear();
    sessions.clear();
    invoices.clear();
    charges.clear();
    invoiceSeq = 0;
    lastCheckoutParams = null;
  }

  return {
    fetch: mockFetch,
    reset,
    advancePeriod,
    failPayment,
    refundFirstCharge,
    reshapeInvoiceNewApi,
    getSubscription,
    getSession,
    getLastCheckoutParams,
    listInvoices,
    findOrCreateCustomer,
  };
}

/** Build a Stripe-Signature header for a webhook payload. */
export function signWebhookEvent(payload, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const rawBody = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');
  return { rawBody, header: `t=${timestamp},v1=${signature}` };
}

/** Build a webhook event object. */
export function webhookEvent(type, object, id = null) {
  return {
    id: id || `evt_${crypto.randomBytes(8).toString('hex')}`,
    object: 'event',
    type,
    created: Math.floor(Date.now() / 1000),
    data: { object },
  };
}
