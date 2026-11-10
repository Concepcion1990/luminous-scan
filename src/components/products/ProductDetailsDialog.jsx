import { useEffect, useState } from 'react';
import PhotoGallery from '@/components/products/PhotoGallery';
import { buildLocationTree, locationPath } from '@/lib/locations';
import { formatMoney, getLevelsForProduct } from '@/lib/inventory';
import { t } from '@/lib/i18n';

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
      path: locationPath(byId.get(level.location_id), byId) || t('productDetails.unknownLocation'),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const codes = [
    product.sku ? t('productDetails.codeSku', { sku: product.sku }) : '',
    product.upc ? t('productDetails.codeUpc', { upc: product.upc }) : '',
    product.barcode ? t('productDetails.codeBarcode', { barcode: product.barcode }) : '',
    product.isbn ? t('productDetails.codeIsbn', { isbn: product.isbn }) : '',
    product.qr_code ? t('productDetails.codeQr', { code: product.qr_code }) : '',
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
            <p className="numeric text-xs text-muted-foreground">{codes.join(' · ') || t('productDetails.noCodes')}</p>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-3">
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{t('productDetails.priceLabel')}</p>
                <p className="numeric text-base font-semibold">{formatMoney(product.price, currency)}</p>
              </div>
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{t('productDetails.costLabel')}</p>
                <p className="numeric text-base font-semibold">{formatMoney(product.cost, currency)}</p>
              </div>
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{t('productDetails.onHandLabel')}</p>
                <p className="numeric text-base font-semibold">
                  {levels.reduce((sum, level) => sum + (level.quantity || 0), 0)}
                </p>
              </div>
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{t('productDetails.reorderLabel')}</p>
                <p className="numeric text-base font-semibold">{product.reorder_point || 0}</p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border p-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {t('productDetails.whereTitle')}
            </p>
            {stock.length === 0 && (
              <p className="mt-1 text-sm text-muted-foreground">{t('productDetails.noStock')}</p>
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
            <Row label={t('productDetails.rowStatus')} value={product.status || t('productDetails.statusActive')} />
            <Row label={t('productDetails.rowCategory')} value={[product.category, product.subcategory].filter(Boolean).join(' · ')} />
            <Row label={t('productDetails.rowTags')} value={(product.tags || []).map((tag) => `#${tag}`).join(' ')} />
            <Row label={t('productDetails.rowBrand')} value={product.brand} />
            <Row label={t('productDetails.rowManufacturer')} value={product.manufacturer} />
            <Row label={t('productDetails.rowAuthor')} value={product.author} />
            <Row label={t('productDetails.rowPublisher')} value={[product.publisher, product.edition].filter(Boolean).join(' · ')} />
            <Row label={t('productDetails.rowCondition')} value={product.condition} />
            <Row label={t('productDetails.rowUnit')} value={product.unit} />
            <Row
              label={t('productDetails.rowReorderAt')}
              value={
                product.reorder_point
                  ? t('productDetails.reorderAtValue', {
                      point: product.reorder_point,
                      unit: product.unit || t('productDetails.unitEach'),
                    })
                  : ''
              }
            />
            <Row label={t('productDetails.rowSupplier')} value={product.supplier_name} />
            <Row label={t('productDetails.rowFulfillment')} value={product.fulfillment_method} />
            <Row label={t('productDetails.rowBatch')} value={product.batch_lot} />
            <Row label={t('productDetails.rowSerial')} value={product.serial_number} />
            <Row label={t('productDetails.rowWarranty')} value={product.warranty} />
            <Row label={t('productDetails.rowWeight')} value={product.weight} />
            <Row label={t('productDetails.rowDimensions')} value={product.dimensions} />
          </div>

          {product.description && (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {t('productDetails.descriptionTitle')}
              </p>
              <p className="mt-1 text-sm">{product.description}</p>
            </div>
          )}

          {product.notes && (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{t('productDetails.notesTitle')}</p>
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