/**
 * CrossStoreAvailability — T6. When an item is listed but OUT OF
 * STOCK at this store, show whether the business's OTHER stores (or a
 * warehouse) have it — and let staff notify that store from the popup:
 * "a customer is interested — ship it to us for when they come back,
 * or bring it over within the next two days if you're close by."
 *
 * Business-only by nature: Essentials has one store, so there is
 * nowhere else to look — the parent never renders this panel on
 * Essentials, and the server refuses the lookup with 403 anyway.
 * The notify call creates a server-side request record the other
 * store's staff can see (their cross-store inbox), not a chat message
 * that can be missed.
 */
import { useEffect, useState } from 'react';
import { apiRequest } from '@/api/client';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Store, Send, Check } from 'lucide-react';

export default function CrossStoreAvailability({ businessId, product }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stores, setStores] = useState([]);
  const [selected, setSelected] = useState(null);
  const [mode, setMode] = useState('ship');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError('');
    setStores([]);
    setSelected(null);
    setSentTo(null);
    apiRequest(`/api/businesses/${encodeURIComponent(businessId)}/cross-store/availability?product_id=${encodeURIComponent(product.id)}`)
      .then((data) => {
        if (!mounted) return;
        setStores(data.stores ?? []);
      })
      .catch((err) => {
        if (mounted) setError(err?.message || 'Could not check the other stores.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [businessId, product.id]);

  const notify = async (store) => {
    setSending(true);
    setError('');
    try {
      await apiRequest(`/api/businesses/${encodeURIComponent(businessId)}/cross-store/requests`, {
        method: 'POST',
        body: {
          target_business_id: store.business_id,
          product_id: product.id,
          mode,
          message: message.trim(),
        },
      });
      setSentTo(store.business_id);
      setSelected(null);
    } catch (err) {
      setError(err?.message || 'Could not send that request.');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Checking the other stores…</p>;
  }
  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }
  if (!stores.length) {
    return (
      <p className="text-sm text-muted-foreground">
        None of your other stores have this item in stock right now.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{t('scan.otherStores')}</p>
      {stores.map((store) => (
        <div key={store.business_id} className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <Store className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">{store.business_name}</p>
                <p className="text-xs text-muted-foreground">
                  {t('scan.availableAt', { store: store.business_name, count: store.total })}
                  {store.locations?.length
                    ? ` (${store.locations.map((l) => `${l.location_name}: ${l.quantity}`).join(', ')})`
                    : ''}
                </p>
              </div>
            </div>
            {sentTo === store.business_id ? (
              <span className="inline-flex items-center gap-1 text-sm text-ok">
                <Check className="h-4 w-4" /> {t('scan.notifySent', { store: store.business_name })}
              </span>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelected(selected === store.business_id ? null : store.business_id)}
              >
                <Send className="mr-1.5 h-3.5 w-3.5" /> {t('scan.notifyStore')}
              </Button>
            )}
          </div>

          {selected === store.business_id && (
            <div className="mt-3 space-y-2 border-t border-border pt-3">
              <p className="text-xs text-muted-foreground">{t('scan.notifyHint')}</p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setMode('ship')}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${mode === 'ship' ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted'}`}
                >
                  {t('scan.notifyShip')}
                </button>
                <button
                  type="button"
                  onClick={() => setMode('bring')}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${mode === 'bring' ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted'}`}
                >
                  {t('scan.notifyBring')}
                </button>
              </div>
              <Input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t('scan.notifyMessage')}
              />
              <Button size="sm" onClick={() => notify(store)} disabled={sending}>
                {sending ? 'Sending…' : `Send request to ${store.business_name}`}
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
