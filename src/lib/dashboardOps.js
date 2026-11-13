import { base44 } from '@/api/client';
import { scoped } from '@/lib/scoped';

/** Orders that still owe the customer stock. */
export const AWAITING_STATUSES = ['new', 'pending', 'reserved', 'packed'];

/** Purchase orders that have not fully arrived. */
export const INCOMING_STATUSES = ['ordered', 'partial'];

/** The two operational lists the overview shows beside the stock picture. */
export async function loadOperations(businessId = '', { includePurchaseOrders = true } = {}) {
  const [ordersPage, poPage] = await Promise.all([
    base44.entities.Order.filter(scoped({ status: { $in: AWAITING_STATUSES } }, businessId), {
      sort: '-created_date',
      limit: 25,
    }),
    // Purchase orders are Business-only: on Essentials the overview never
    // asks for them, so the incoming-stock card has nothing to show even
    // before its render guard runs.
    includePurchaseOrders
      ? base44.entities.PurchaseOrder.filter(scoped({ status: { $in: INCOMING_STATUSES } }, businessId), {
          sort: 'expected_date',
          limit: 25,
        })
      : Promise.resolve({ items: [] }),
  ]);
  return {
    orders: ordersPage.items ?? [],
    purchaseOrders: poPage.items ?? [],
  };
}