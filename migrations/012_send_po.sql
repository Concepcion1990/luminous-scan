-- 012_send_po.sql — Send purchase orders from inside the app.
--
-- A placed purchase order can be emailed to its supplier from the
-- Purchasing page (Business plan only, enforced server-side). The
-- send leaves its record ON the order itself, so the page can show
-- that it went, when, and to which address:
--
--   purchase_orders.sent_at     when the most recent send succeeded
--                               (NULL until the first successful send)
--   purchase_orders.sent_to     the supplier address the most recent
--                               send went to ('' until then)
--   purchase_orders.send_count  how many sends have succeeded,
--                               re-sends included
--
-- These columns are written ONLY by the send endpoint
-- (server/business.js sendPurchaseOrder) after the mailer confirms
-- the send. A failed or unconfigured send writes nothing — an order
-- is never recorded as sent when it was not. The entity guards
-- refuse direct browser writes to all three (server/entities.js).

ALTER TABLE purchase_orders ADD COLUMN sent_at TIMESTAMPTZ;
ALTER TABLE purchase_orders ADD COLUMN sent_to TEXT NOT NULL DEFAULT '';
ALTER TABLE purchase_orders ADD COLUMN send_count INTEGER NOT NULL DEFAULT 0;
