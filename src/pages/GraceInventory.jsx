import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Eye } from 'lucide-react';
import { base44 } from '@/api/client';
import useEntitlements from '@/hooks/useEntitlements';
import { scoped } from '@/lib/scoped';
import { listProducts } from '@/lib/inventory';
import { assessCancellationGrace, CANCELLATION_GRACE_DAYS, CANCELLATION_GRACE_PARAGRAPH } from '@/lib/cancellationGrace';
import { Button } from '@/components/ui/button';

function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/**
 * Read-only grace view — shown ONLY while a canceled subscription is past
 * its paid-through date but still inside the 15-day grace window
 * (owner-decided 2026-11-07).
 *
 * The customer can still log in and SEE their products (their inventory
 * list) so they can look at what they had and write it down. NOTHING else:
 * no adding, editing, deleting, scanning, importing, exporting or
 * migrating, no settings, no staff — this page has no links into the app
 * except a re-subscribe link to /plans, and it renders no action buttons
 * at all. There is deliberately no export option here, for any plan:
 * Essentials has no export anyway, and Business loses it in grace. The
 * paid-through window before this was the time to export or sort things
 * out.
 *
 * After the 15 days, full lockout: this page redirects to /plans and the
 * data is no longer reachable. After the 15-day grace period ends, the
 * account and all its information are permanently deleted and cannot be
 * recovered — resubscribing starts fresh. (The wipe sweep runs daily on
 * the server — server/billing.js runWipeSweep — and keeps the
 * TrialHistory row.)
 *
 * Enforcement note: the grace view itself is a routing decision (the
 * same as PlanGate and SubscriptionAccessRoute), AND every write is
 * refused server-side while in grace (server/billing.js
 * assertNotInGrace, enforced in server/entities.js and
 * server/shopRoutes.js) — a customer cannot change, scan, import, or
 * export their way around this page. The grace decision itself is the
 * shared pure rule in `src/lib/cancellationGrace.js`, mirrored
 * server-side in server/billing.js graceStateFor.
 */
export default function GraceInventory() {
  const { status, record, activeId, isLoading } = useEntitlements();
  const [products, setProducts] = useState(null);
  const [totalProducts, setTotalProducts] = useState(null);
  const [levels, setLevels] = useState([]);

  const grace = useMemo(
    () => assessCancellationGrace({ status, paidThrough: record?.period_ends_at }),
    [status, record?.period_ends_at]
  );

  useEffect(() => {
    if (grace.state !== 'grace' || !activeId) return;
    let cancelled = false;
    (async () => {
      try {
        const [items, levelPage] = await Promise.all([
          listProducts({ limit: 200, businessId: activeId }),
          base44.entities.StockLevel.filter(scoped({}, activeId), { limit: 2000 }),
        ]);
        // The list above is capped at 200 rows, so count the catalog
        // separately and say so — a Business customer with more than 200
        // products must not mistake the first 200 for everything they had.
        // A failed count only hides the notice, never the products.
        let total = null;
        try {
          total = await base44.entities.Product.count(scoped({}, activeId));
        } catch {
          total = null;
        }
        if (!cancelled) {
          setProducts(items ?? []);
          setTotalProducts(total);
          setLevels(levelPage?.items ?? []);
        }
      } catch {
        if (!cancelled) setProducts([]);
      }
    })();
    return () => { cancelled = true; };
  }, [grace.state, activeId]);

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-4">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  // Fail closed: anyone who is not in the grace window does not see this
  // page. Full access goes back into the app; everyone else to Plans.
  if (grace.state === 'full_access') return <Navigate to="/" replace />;
  if (grace.state !== 'grace') return <Navigate to="/plans" replace />;

  const onHandByProduct = new Map();
  levels.forEach((level) => {
    const current = onHandByProduct.get(level.product_id) || 0;
    onHandByProduct.set(level.product_id, current + (level.quantity || 0));
  });

  return (
    <div className="min-h-dvh bg-background px-4 py-8 text-foreground">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-1">
          <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Eye className="h-4 w-4" aria-hidden="true" />
            Luminous StockHaven — read-only view
          </p>
          <h1 className="text-2xl font-bold">Your products</h1>
        </header>

        <div role="status" className="space-y-2 rounded-lg border border-border bg-muted/40 px-4 py-4 text-sm leading-relaxed">
          <p className="font-semibold">
            Your subscription ended{formatDate(grace.paidThrough) ? ` on ${formatDate(grace.paidThrough)}` : ''}.
            This is a read-only view until {formatDate(grace.graceEndsAt) || `the end of your ${CANCELLATION_GRACE_DAYS}-day grace period`}.
          </p>
          <p className="text-muted-foreground">
            You can look at your products below and write down anything you need.
            You cannot add, edit, delete, scan, import, export or move anything here —
            including export: no plan can export from this view. {CANCELLATION_GRACE_PARAGRAPH}
          </p>
          <p>
            <Link to="/plans" className="font-medium text-primary underline underline-offset-4">
              See plans to subscribe again
            </Link>
          </p>
        </div>

        {products === null ? (
          <p className="text-sm text-muted-foreground">Loading your products…</p>
        ) : products.length === 0 ? (
          <p className="text-sm text-muted-foreground">No products to show.</p>
        ) : (
          <>
            {totalProducts !== null && (
              <p className="mb-2 text-sm text-muted-foreground">
                {totalProducts > products.length
                  ? `Showing the first ${products.length} of ${totalProducts} products — subscribe again to see the rest.`
                  : `${totalProducts} ${totalProducts === 1 ? 'product' : 'products'} in total.`}
              </p>
            )}
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left">
                    <th scope="col" className="px-3 py-2 font-semibold">Product</th>
                    <th scope="col" className="px-3 py-2 font-semibold">SKU</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">On hand</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 font-medium">{product.name || 'Unnamed product'}</td>
                      <td className="px-3 py-2 text-muted-foreground">{product.sku || '—'}</td>
                      <td className="px-3 py-2 text-right">{onHandByProduct.get(product.id) ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <p className="text-xs text-muted-foreground">
          Read-only. To change anything, subscribe again from the Plans page.
        </p>
        <Button asChild variant="outline">
          <Link to="/plans">See plans</Link>
        </Button>
      </div>
    </div>
  );
}
