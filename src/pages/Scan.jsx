import { useEffect, useRef, useState } from 'react';
import { base44 } from '@/api/client';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, Check, MapPin, PackageSearch, Plus, RotateCcw, TriangleAlert } from 'lucide-react';
import BarcodeScanner from '@/components/scan/BarcodeScanner';
import ExternalCodePanel from '@/components/scan/ExternalCodePanel';
import MatchPicker from '@/components/scan/MatchPicker';
import QuantityStepper from '@/components/inventory/QuantityStepper';
import ProductFormDialog from '@/components/products/ProductFormDialog';
import ProductDetailsDialog from '@/components/products/ProductDetailsDialog';
import ScanProductList from '@/components/scan/ScanProductList';
import ScannerListener from '@/components/scan/ScannerListener';
import useScannerInput from '@/hooks/useScannerInput';
import useIsDesktop from '@/hooks/useIsDesktop';
import useModalHistory from '@/hooks/useModalHistory';
import PullToRefresh from '@/components/mobile/PullToRefresh';
import {
  findProductsByCode,
  getLevelsForProduct,
  MOVEMENT_TYPES,
  recordMovement,
  setReserved,
} from '@/lib/inventory';
import { classifyScan } from '@/lib/scanCode';
import { orderedLocations } from '@/lib/locations';
import { scoped } from '@/lib/scoped';
import { useBusiness } from '@/hooks/useBusiness';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import ResponsiveSelect from '@/components/ui/ResponsiveSelect';

const actions = [
  { key: 'receive', label: 'Receive', hint: 'Stock that arrived' },
  { key: 'sale', label: 'Sold', hint: 'Stock that left the shelf' },
  { key: 'count', label: 'Count', hint: 'Set the exact on-hand' },
  { key: 'transfer', label: 'Transfer', hint: 'Move to another site' },
];

const adjustments = [
  { key: 'returned', label: 'Return', hint: 'Came back from a customer' },
  { key: 'damaged', label: 'Damaged', hint: 'Unsellable, kept on record' },
  { key: 'lost', label: 'Lost', hint: 'Missing from the shelf' },
  { key: 'found', label: 'Found', hint: 'Turned up again' },
  { key: 'write_off', label: 'Write off', hint: 'Taken off the books' },
  { key: 'correction', label: 'Correction', hint: 'Fix a quantity recorded wrong' },
  { key: 'reserved', label: 'Hold', hint: 'Reserve stock for an order' },
  { key: 'released', label: 'Release', hint: 'Free held stock again' },
];

const allActions = [...actions, ...adjustments];

export default function Scan() {
  const { activeId, profile } = useBusiness();
  const isDesktop = useIsDesktop();
  const { pathname } = useLocation();
  // A retained mobile Scan tab preserves its form state but must release the camera
  // and scanner listeners when another route becomes active.
  const scanVisible = pathname === '/scan';
  const { open: createOpen, onOpenChange: setCreateOpen } = useModalHistory({
    modalId: 'scan-product-form',
    routePath: '/scan',
    mobile: !isDesktop,
  });
  const { open: detailsOpen, onOpenChange: setDetailsOpen } = useModalHistory({
    modalId: 'scan-product-details',
    routePath: '/scan',
    mobile: !isDesktop,
  });
  const [locations, setLocations] = useState([]);
  const [locationId, setLocationId] = useState(localStorage.getItem('stockroom.location') || '');
  const [session, setSession] = useState(0);
  const [manual, setManual] = useState('');
  const [product, setProduct] = useState(null);
  const currentProductIdRef = useRef(null);
  currentProductIdRef.current = product?.id ?? null;
  const currentBusinessIdRef = useRef(activeId);
  currentBusinessIdRef.current = activeId;
  const [matches, setMatches] = useState([]);
  const [levels, setLevels] = useState([]);
  const [notFound, setNotFound] = useState(null);
  const [external, setExternal] = useState(null);
  const [action, setAction] = useState('receive');
  const [qty, setQty] = useState('1');
  const [note, setNote] = useState('');
  const [cost, setCost] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);
  const [error, setError] = useState('');
  const [details, setDetails] = useState(null);
  const [user, setUser] = useState(null);
  const busyRef = useRef(false);
  const savingRef = useRef(false);
  const manualRef = useRef(null);
  const scanListRef = useRef(null);

  useEffect(() => {
    (async () => {
      const page = await base44.entities.Location.filter(scoped({}, activeId), {
        sort: 'name',
        limit: 100,
      });
      const list = page.items ?? [];
      setLocations(list);
      if (!list.find((l) => l.id === locationId)) {
        setLocationId(list[0]?.id || '');
      }
    })();
    base44.auth.me().then(setUser).catch(() => setUser(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // A different business has a different catalog: forget the scanned product.
  useEffect(() => {
    clearResult();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  useEffect(() => {
    if (locationId) localStorage.setItem('stockroom.location', locationId);
  }, [locationId]);

  const location = locations.find((l) => l.id === locationId);
  const toLocation = locations.find((l) => l.id === toLocationId);
  // A transfer needs somewhere to go: with one location (or none) the
  // action is disabled up front instead of failing on the final tap.
  const canTransfer = locations.length > 1;
  const here = levels.find((l) => l.location_id === locationId);
  const onHand = here?.quantity ?? 0;
  const held = here?.reserved ?? 0;
  const isHold = action === 'reserved' || action === 'released';

  const clearResult = () => {
    setProduct(null);
    setLevels([]);
    setMatches([]);
    setNotFound(null);
    setExternal(null);
  };

  const selectProduct = async (match) => {
    setExternal(null);
    setMatches([]);
    setNotFound(null);
    setProduct(match);
    setLevels(await getLevelsForProduct(match.id, activeId || ''));
  };

  /**
   * One lookup for every code type. It only reads inventory: nothing is
   * created, received, sold or moved until a stock action is confirmed.
   */
  const lookup = async (raw) => {
    if (busyRef.current) return;
    const code = String(raw || '').trim();
    if (!code) return;
    busyRef.current = true;
    setError('');
    setFlash(null);
    try {
      const found = await findProductsByCode(code, activeId || '');
      if (found.length === 1) {
        await selectProduct(found[0]);
      } else if (found.length > 1) {
        clearResult();
        setMatches(found);
      } else {
        const scanned = classifyScan(code);
        clearResult();
        if (scanned.kind === 'identifier') {
          setNotFound(code);
        } else if (scanned.kind !== 'empty') {
          setExternal(scanned);
        }
      }
    } catch {
      setError('Could not look that code up. Check your connection and try again.');
    } finally {
      busyRef.current = false;
    }
  };

  const reset = () => {
    clearResult();
    setManual('');
    setNote('');
    setCost('');
    setQty('1');
    setError('');
    setFlash(null);
    setSession((s) => s + 1);
    // The reader types into whatever is focused, so hand it back the scan box.
    if (isDesktop) manualRef.current?.focus();
  };

  const apply = async () => {
    // Guards against a double tap or a repeated Enter saving the movement twice.
    if (savingRef.current) return;
    setError('');
    if (!location) {
      setError('Choose a location first.');
      return;
    }
    const amount = Number(qty);
    if (Number.isNaN(amount) || amount < 0) {
      setError('Enter a quantity.');
      return;
    }
    const setsExact = action === 'count' || action === 'correction';
    if (!setsExact && amount < 1) {
      setError('Quantity must be at least 1.');
      return;
    }
    if (action === 'transfer') {
      if (!toLocation) {
        setError('Choose where the stock is going.');
        return;
      }
      if (toLocation.id === location.id) {
        setError('Pick a different destination location.');
        return;
      }
    }
    if (['sale', 'damaged', 'lost', 'write_off'].includes(action) && amount > onHand) {
      setError(`Only ${onHand} on hand at ${location.name}.`);
      return;
    }

    // Holding stock never touches the on-hand quantity: only the reserved count moves.
    if (isHold) {
      if (amount < 1) {
        setError('Enter how many to hold.');
        return;
      }
      savingRef.current = true;
      setBusy(true);
      try {
        const { next } = await setReserved({
          product,
          location,
          type: action,
          quantity: amount,
          note,
          reference: note,
          user,
          businessId: activeId || '',
        });
        setLevels(await getLevelsForProduct(product.id, activeId || ''));
        setQty('1');
        setNote('');
        setFlash(
          `${action === 'reserved' ? 'Held' : 'Released'} ${amount} · ${product.name} now ${next} held at ${location.name}`
        );
      } catch (err) {
        setError(err?.message || 'Could not update the hold.');
      } finally {
        savingRef.current = false;
        setBusy(false);
      }
      return;
    }

    savingRef.current = true;
    setBusy(true);
    try {
      const { next } = await recordMovement({
        product,
        location,
        type: action,
        quantity: amount,
        note,
        scannedCode: product.upc || product.barcode || product.sku,
        toLocation,
        user,
        unitCost: action === 'receive' ? cost : '',
        reference: action === 'receive' ? note : '',
        businessId: activeId || '',
      });
      if (action === 'receive' && Number(cost) > 0) {
        await base44.entities.Product.update(product.id, { cost: Number(cost) });
      }
      setLevels(await getLevelsForProduct(product.id, activeId || ''));
      setQty('1');
      setNote('');
      setCost('');
      const verb = MOVEMENT_TYPES[action]?.label || 'Recorded';
      setFlash(
        action === 'transfer'
          ? `${verb} ${amount} to ${toLocation.name} · ${product.name} now ${next} at ${location.name}`
          : `${verb} ${amount} · ${product.name} now ${next} at ${location.name}`
      );
    } catch (err) {
      setError(err?.message || 'Could not record this movement.');
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  };

  // A handheld reader types the code and presses Enter; catch it wherever the page has focus.
  const { armed, lastCode } = useScannerInput({
    onScan: lookup,
    enabled: scanVisible && isDesktop && !createOpen && !details,
  });

  useEffect(() => {
    if (isDesktop && scanVisible) manualRef.current?.focus();
  }, [isDesktop, scanVisible]);

  // A pull only re-reads data. It does not restart the camera, clear a scan,
  // reset a stock action, or create any stock movements.
  const refreshScanData = async () => {
    if (!scanVisible || busy || busyRef.current || savingRef.current) return;
    const businessId = activeId || '';
    const requestedProductId = product?.id ?? null;
    const [locationPage, latestLevels] = await Promise.all([
      base44.entities.Location.filter(scoped({}, activeId), { sort: 'name', limit: 100 }),
      product ? getLevelsForProduct(product.id, businessId) : Promise.resolve(null),
      scanListRef.current?.refresh() ?? Promise.resolve(),
    ]);
    if (currentBusinessIdRef.current !== activeId) return;
    setLocations(locationPage.items ?? []);
    if (requestedProductId && currentProductIdRef.current === requestedProductId && latestLevels !== null) {
      setLevels(latestLevels);
    }
  };

  const idle = !product && !notFound && !external && matches.length === 0;

  return (
    <PullToRefresh
      className="space-y-5"
      onRefresh={refreshScanData}
      disabled={!scanVisible || busy || createOpen || detailsOpen}
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Scan station</p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">Scan an item</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One scanner for barcodes, UPC, ISBN and QR codes. Point the camera and the app works out what it is.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-muted-foreground" />
          <ResponsiveSelect
            value={locationId}
            onValueChange={setLocationId}
            title="Choose scan location"
            ariaLabel="Select scanning location"
            placeholder="Choose location"
            className="w-[210px] bg-card"
            options={orderedLocations(locations).map(({ location: l, depth }) => ({
              value: l.id,
              label: `${'— '.repeat(depth)}${l.name}`,
            }))}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
          <div data-pull-refresh-ignore>
            {scanVisible && <BarcodeScanner key={session} onDetect={lookup} />}
          </div>

          <div className="space-y-2">
            <Label htmlFor="manual" className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Or type / use a handheld scanner
            </Label>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const code = manual;
                setManual('');
                lookup(code);
              }}
            >
              <Input
                id="manual"
                ref={manualRef}
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                onFocus={(e) => e.target.select()}
                placeholder="SKU, UPC, ISBN or barcode"
                className="numeric"
                autoComplete="off"
              />
              <Button type="submit" variant="outline">
                Find
              </Button>
            </form>
            <p className="text-[11px] text-muted-foreground">
              Scanning never changes stock. Receive, sold, count and transfer are always separate actions.
            </p>

            <ScannerListener
              armed={armed}
              lastCode={lastCode}
              onFocusInput={() => manualRef.current?.focus()}
            />
          </div>

          {flash && (
            <div className="flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/8 p-3 text-sm text-ok">
              <Check className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="text-foreground">{flash}</span>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card">
          {external && <ExternalCodePanel scanned={external} onDismiss={reset} onSearch={lookup} />}

          {matches.length > 0 && (
            <MatchPicker matches={matches} onSelect={selectProduct} onDismiss={reset} />
          )}

          {idle && (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-16 text-center">
              <PackageSearch className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm font-medium">Waiting for a scan</p>
              <p className="max-w-[260px] text-xs text-muted-foreground">
                A matched product and its stock actions appear here. Website, text and product-detail codes
                are shown with their own actions instead.
              </p>
            </div>
          )}

          {notFound && (
            <div className="space-y-4 px-6 py-12 text-center">
              <TriangleAlert className="mx-auto h-6 w-6 text-warn" />
              <div>
                <p className="text-sm font-medium">No product matches that code</p>
                <p className="numeric mt-1 text-xs text-muted-foreground">{notFound}</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="mr-1.5 h-4 w-4" /> Create product
                </Button>
                <Button variant="ghost" onClick={reset}>
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Scan next
                </Button>
              </div>
            </div>
          )}

          {product && (
            <div className="divide-y divide-border">
              <div className="p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold">{product.name}</h2>
                    <p className="numeric mt-1 text-xs text-muted-foreground">
                      {[product.sku, product.upc, product.isbn].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={reset} className="shrink-0">
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Scan next
                  </Button>
                </div>

                <div className="mt-4 space-y-1.5">
                  {orderedLocations(locations).map(({ location: l, depth }) => {
                    const level = levels.find((lv) => lv.location_id === l.id);
                    const q = level?.quantity ?? 0;
                    const holds = level?.reserved ?? 0;
                    const isLow = product.reorder_point > 0 && q <= product.reorder_point;
                    return (
                      <div
                        key={l.id}
                        className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-sm ${
                          l.id === locationId ? 'bg-secondary font-medium' : ''
                        }`}
                        style={depth ? { marginLeft: `${Math.min(depth, 3) * 10}px` } : undefined}
                      >
                        <span className="flex items-center gap-2 truncate">
                          {l.name}
                          {l.id === locationId && (
                            <span className="rounded bg-primary px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-primary-foreground">
                              here
                            </span>
                          )}
                        </span>
                        <span className={`numeric ${isLow ? 'text-warn' : 'text-muted-foreground'}`}>
                          {q}
                          {holds > 0 && <span className="text-accent"> · {holds} held</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-4 p-4 sm:p-5">
                <div className="grid grid-cols-2 gap-2">
                  {actions.map((a) => {
                    const disabled = a.key === 'transfer' && !canTransfer;
                    return (
                      <button
                        key={a.key}
                        type="button"
                        disabled={disabled}
                        title={disabled ? 'Add a second location to transfer' : a.hint}
                        onClick={() => setAction(a.key)}
                        className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                          disabled
                            ? 'cursor-not-allowed border-border opacity-50'
                            : action === a.key
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border hover:bg-muted'
                        }`}
                      >
                        <span className="block text-sm font-medium">{a.label}</span>
                        <span
                          className={`block text-[11px] ${
                            action === a.key && !disabled
                              ? 'text-primary-foreground/60'
                              : 'text-muted-foreground'
                          }`}
                        >
                          {disabled ? 'Add a second location to transfer' : a.hint}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-1.5">
                  <Label className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    Adjustments
                  </Label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {adjustments.map((a) => (
                      <button
                        key={a.key}
                        type="button"
                        title={a.hint}
                        onClick={() => setAction(a.key)}
                        className={`rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
                          action === a.key
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border hover:bg-muted'
                        }`}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    {action === 'reserved'
                      ? `How many to hold · ${Math.max(onHand - held, 0)} available`
                      : action === 'released'
                        ? `How many to release · ${held} held`
                        : `${action === 'count' ? 'Counted quantity'
                            : action === 'correction' ? 'Corrected quantity'
                            : 'Quantity'} · ${onHand} on hand here`}
                  </Label>
                  <QuantityStepper
                    value={qty}
                    onChange={setQty}
                    allowZero={action === 'count' || action === 'correction'}
                  />
                </div>

                {action === 'transfer' && (
                  <div className="grid gap-2">
                    <Label className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                      Destination
                    </Label>
                    <ResponsiveSelect
                      value={toLocationId}
                      onValueChange={setToLocationId}
                      title="Choose transfer destination"
                      ariaLabel="Select transfer destination"
                      placeholder="Where is it going?"
                      options={orderedLocations(locations)
                        .filter(({ location }) => location.id !== locationId)
                        .map(({ location: l, depth }) => ({
                          value: l.id,
                          label: `${'— '.repeat(depth)}${l.name}`,
                        }))}
                    />
                  </div>
                )}

                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Note (optional) — PO number, reason, count sheet"
                />

                {action === 'receive' && (
                  <div className="grid gap-2">
                    <Label className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                      Unit cost paid (optional)
                    </Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={cost}
                      onChange={(e) => setCost(e.target.value)}
                      placeholder={product.cost ? `Currently ${product.cost}` : 'What you paid each'}
                    />
                  </div>
                )}

                {error && <p className="text-sm text-destructive">{error}</p>}

                <Button className="w-full" onClick={apply} disabled={busy}>
                  {busy
                    ? 'Recording…'
                    : `Record ${(allActions.find((a) => a.key === action)?.label || 'movement').toLowerCase()}`}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <ScanProductList
        ref={scanListRef}
        locations={locations}
        locationId={locationId}
        businessId={activeId || ''}
        currency={profile?.currency}
        onOpenProduct={(nextProduct) => {
          setDetails(nextProduct);
          setDetailsOpen(true);
        }}
      />

      <p className="text-xs text-muted-foreground">
        Looking for the product list?{' '}
        <Link to="/products" className="font-medium underline underline-offset-2">
          Open products <ArrowRight className="inline h-3 w-3" />
        </Link>
      </p>

      <ProductFormDialog
        open={scanVisible && createOpen}
        onOpenChange={setCreateOpen}
        defaultCode={notFound}
        onSaved={async (saved) => {
          setNotFound(null);
          setProduct(saved);
          setLevels([]);
          setSession((s) => s + 1);
        }}
      />

      <ProductDetailsDialog
        product={details}
        locations={locations}
        currency={profile?.currency || 'USD'}
        open={scanVisible && detailsOpen && Boolean(details)}
        onOpenChange={(next) => {
          setDetailsOpen(next);
          if (!next) setDetails(null);
        }}
      />
    </PullToRefresh>
  );
}