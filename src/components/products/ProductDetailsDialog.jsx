import { useEffect, useState } from 'react';
import PhotoGallery from '@/components/products/PhotoGallery';
import { buildLocationTree, locationPath } from '@/lib/locations';
import { formatMoney, getLevelsForProduct } from '@/lib/inventory';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

function Row({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-sm">{value}</span>
    </div>
  );
}

/** Read-only product sheet: opened from a product name anywhere in the app. */
export default function ProductDetailsDialog({ product, locations = [], currency = 'USD', open, onOpenChange }) {
  const [levels, setLevels] = useState([]);
  const { byId } = buildLocationTree(locations);

  useEffect(() => {
    if (!open || !product) return;
    let active = true;
    setLevels([]);
    getLevelsForProduct(product.id, product.business_id || '').then((rows) => {
      if (active) setLevels(rows);
    });
    return () => {
      active = false;
    };
  }, [open, product]);

  if (!product) return null;

  const stock = levels
    .filter((level) => (level.quantity || 0) > 0)
    .map((level) => ({
      quantity: level.quantity,
      path: locationPath(byId.get(level.location_id), byId) || 'Unknown location',
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const codes = [
    product.sku ? `SKU ${product.sku}` : '',
    product.upc ? `UPC ${product.upc}` : '',
    product.barcode ? `Barcode ${product.barcode}` : '',
    product.isbn ? `ISBN ${product.isbn}` : '',
    product.qr_code ? `QR ${product.qr_code}` : '',
  ].filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="pr-6 text-left">{product.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <PhotoGallery photos={product.photo_urls || []} name={product.name} />

          <div className="min-w-0">
            <p className="numeric text-xs text-muted-foreground">{codes.join(' · ') || 'No codes'}</p>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-3">
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Price</p>
                <p className="numeric text-base font-semibold">{formatMoney(product.price, currency)}</p>
              </div>
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Cost</p>
                <p className="numeric text-base font-semibold">{formatMoney(product.cost, currency)}</p>
              </div>
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">On hand</p>
                <p className="numeric text-base font-semibold">
                  {levels.reduce((sum, level) => sum + (level.quantity || 0), 0)}
                </p>
              </div>
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Reorder</p>
                <p className="numeric text-base font-semibold">{product.reorder_point || 0}</p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border p-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Where it is
            </p>
            {stock.length === 0 && (
              <p className="mt-1 text-sm text-muted-foreground">No stock recorded at any location.</p>
            )}
            <div className="mt-1 space-y-0.5">
              {stock.map((entry) => (
                <div key={entry.path} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">{entry.path}</span>
                  <span className="numeric font-semibold">{entry.quantity}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-border p-3">
            <Row label="Status" value={product.status || 'active'} />
            <Row label="Category" value={[product.category, product.subcategory].filter(Boolean).join(' · ')} />
            <Row label="Tags" value={(product.tags || []).map((tag) => `#${tag}`).join(' ')} />
            <Row label="Brand" value={product.brand} />
            <Row label="Manufacturer" value={product.manufacturer} />
            <Row label="Author" value={product.author} />
            <Row label="Publisher" value={[product.publisher, product.edition].filter(Boolean).join(' · ')} />
            <Row label="Condition" value={product.condition} />
            <Row label="Unit" value={product.unit} />
            <Row
              label="Reorder at"
              value={product.reorder_point ? `${product.reorder_point} ${product.unit || 'each'}` : ''}
            />
            <Row label="Supplier" value={product.supplier_name} />
            <Row label="Fulfillment" value={product.fulfillment_method} />
            <Row label="Batch / lot" value={product.batch_lot} />
            <Row label="Serial" value={product.serial_number} />
            <Row label="Warranty" value={product.warranty} />
            <Row label="Weight" value={product.weight} />
            <Row label="Dimensions" value={product.dimensions} />
          </div>

          {product.description && (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Description
              </p>
              <p className="mt-1 text-sm">{product.description}</p>
            </div>
          )}

          {product.notes && (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Notes</p>
              <p className="mt-1 text-sm">{product.notes}</p>
            </div>
          )}

          {(product.custom_fields || []).length > 0 && (
            <div className="rounded-lg border border-border p-3">
              {product.custom_fields
                .filter((field) => field.label)
                .map((field) => (
                  <Row key={field.label} label={field.label} value={field.value} />
                ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}