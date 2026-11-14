import { useEffect, useRef, useState } from 'react';
import { base44 } from '@/api/client';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { useBusiness } from '@/hooks/useBusiness';
import useEntitlements from '@/hooks/useEntitlements';
import ProductDetailsFields from './ProductDetailsFields';
import { useCatalogVocabulary } from '@/hooks/useCatalogVocabulary';
import { copyGroupKey } from '@/lib/copies';
import { scoped, withBusiness } from '@/lib/scoped';
import { createProducts } from '@/lib/entitlements';
import { Image } from '@/components/ui/image';
import { t } from '@/lib/i18n';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const CONDITIONS = ['New', 'Like new', 'Very good', 'Good', 'Acceptable'];

const empty = {
  name: '',
  sku: '',
  upc: '',
  isbn: '',
  author: '',
  condition: '',
  category: '',
  unit: 'each',
  cost: '',
  price: '',
  pricing_mode: 'regular',
  clearance_price: '',
  sale_price: '',
  sale_start: '',
  sale_end: '',
  reorder_point: '',
  supplier_id: '',
  notes: '',
  barcode: '',
  qr_code: '',
  description: '',
  subcategory: '',
  tags_text: '',
  brand: '',
  manufacturer: '',
  publisher: '',
  edition: '',
  status: 'active',
  fulfillment_method: 'owner_stocked',
  acquisition_date: '',
  expiration_date: '',
  weight: '',
  dimensions: '',
  batch_lot: '',
  serial_number: '',
  warranty: '',
  custom_fields: [],
  copy_group: '',
  variant_label: '',
  variant_options: [],
  photo_urls: [],
};

export default function ProductFormDialog({ open, onOpenChange, product, seed, defaultCode, onSaved }) {
  const { activeId } = useBusiness();
  // Clearance + rollback pricing is Business-only (migration 018).
  // Off-Business the section is a locked note AND the submit payload
  // omits the pricing fields entirely: an unrelated edit must never
  // erase pricing a downgraded business is holding (the server also
  // refuses pricing writes off-Business and strips them from reads).
  const { can } = useEntitlements();
  const canPricing = can('pricing');
  const vocabulary = useCatalogVocabulary(open ? activeId : '');
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [suppliers, setSuppliers] = useState([]);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const CONDITION_LABELS = {
    New: t('products.conditionNew'),
    'Like new': t('products.conditionLikeNew'),
    'Very good': t('products.conditionVeryGood'),
    Good: t('products.conditionGood'),
    Acceptable: t('products.conditionAcceptable'),
  };

  const UNIT_LABELS = {
    each: t('productForm.unitEach'),
    case: t('productForm.unitCase'),
    pair: t('productForm.unitPair'),
    pack: t('productForm.unitPack'),
    kg: t('productForm.unitKg'),
  };

  useEffect(() => {
    if (!open) return;
    setError('');
    if (product) {
      setForm({
        name: product.name || '',
        sku: product.sku || '',
        upc: product.upc || '',
        isbn: product.isbn || '',
        author: product.author || '',
        condition: product.condition || '',
        category: product.category || '',
        supplier_id: product.supplier_id || '',
        unit: product.unit || 'each',
        cost: product.cost ?? '',
        price: product.price ?? '',
        pricing_mode: product.pricing_mode || 'regular',
        clearance_price: product.clearance_price ?? '',
        sale_price: product.sale_price ?? '',
        sale_start: product.sale_start || '',
        sale_end: product.sale_end || '',
        reorder_point: product.reorder_point ?? '',
        notes: product.notes || '',
        barcode: product.barcode || '',
        qr_code: product.qr_code || '',
        description: product.description || '',
        subcategory: product.subcategory || '',
        tags_text: (product.tags || []).join(', '),
        brand: product.brand || '',
        manufacturer: product.manufacturer || '',
        publisher: product.publisher || '',
        edition: product.edition || '',
        status: product.status || 'active',
        fulfillment_method: product.fulfillment_method || 'owner_stocked',
        acquisition_date: product.acquisition_date || '',
        expiration_date: product.expiration_date || '',
        weight: product.weight || '',
        dimensions: product.dimensions || '',
        batch_lot: product.batch_lot || '',
        serial_number: product.serial_number || '',
        warranty: product.warranty || '',
        custom_fields: product.custom_fields || [],
        copy_group: product.copy_group || '',
        variant_label: product.variant_label || '',
        variant_options: product.variant_options || [],
        photo_urls: product.photo_urls || [],
      });
    } else if (seed) {
      setForm({
        ...empty,
        name: seed.name || '',
        isbn: seed.isbn || '',
        author: seed.author || '',
        category: seed.category || '',
        subcategory: seed.subcategory || '',
        brand: seed.brand || '',
        manufacturer: seed.manufacturer || '',
        publisher: seed.publisher || '',
        edition: seed.edition || '',
        condition: seed.condition || '',
        unit: seed.unit || 'each',
        cost: seed.cost ?? '',
        price: seed.price ?? '',
        pricing_mode: seed.pricing_mode || 'regular',
        clearance_price: seed.clearance_price ?? '',
        sale_price: seed.sale_price ?? '',
        sale_start: seed.sale_start || '',
        sale_end: seed.sale_end || '',
        reorder_point: seed.reorder_point ?? '',
        supplier_id: seed.supplier_id || '',
        fulfillment_method: seed.fulfillment_method || 'owner_stocked',
        copy_group: copyGroupKey(seed),
        variant_options: [],
        photo_urls: [],
      });
    } else {
      setForm({ ...empty, barcode: defaultCode || '', upc: defaultCode || '' });
    }
  }, [open, product, seed, defaultCode]);

  useEffect(() => {
    if (!open) return;
    base44.entities.Supplier
      .filter(scoped({}, activeId), { sort: 'name', limit: 200 })
      .then((page) => setSuppliers(page.items ?? []));
  }, [open, activeId]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e?.target ? e.target.value : e }));

  const addPhotos = async (files) => {
    if (!files?.length) return;
    setError('');
    setUploading(true);
    try {
      const urls = [];
      for (const file of files) {
        const { file_url } = await base44.integrations.Core.UploadPublicFile({ file });
        urls.push(file_url);
      }
      setForm((f) => ({ ...f, photo_urls: [...f.photo_urls, ...urls].slice(0, 6) }));
    } catch {
      setError(t('productForm.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.sku.trim()) {
      setError(t('productForm.nameSkuRequired'));
      return;
    }
    setSaving(true);
    setError('');
    const payload = {
      name: form.name.trim(),
      sku: form.sku.trim().toUpperCase(),
      upc: form.upc.trim(),
      isbn: form.isbn.trim(),
      author: form.author.trim(),
      condition: form.condition,
      category: form.category.trim(),
      unit: form.unit,
      cost: Number(form.cost) || 0,
      price: Number(form.price) || 0,
      ...(canPricing
        ? {
            pricing_mode: form.pricing_mode,
            clearance_price:
              form.pricing_mode === 'clearance' && form.clearance_price !== ''
                ? Number(form.clearance_price)
                : null,
            sale_price:
              form.pricing_mode === 'rollback' && form.sale_price !== ''
                ? Number(form.sale_price)
                : null,
            sale_start: form.pricing_mode === 'rollback' ? form.sale_start || null : null,
            sale_end: form.pricing_mode === 'rollback' ? form.sale_end || null : null,
          }
        : {}),
      reorder_point: Number(form.reorder_point) || 0,
      supplier_id: form.supplier_id,
      supplier_name: suppliers.find((s) => s.id === form.supplier_id)?.name || '',
      notes: form.notes.trim(),
      barcode: form.barcode.trim(),
      qr_code: form.qr_code.trim(),
      description: form.description.trim(),
      subcategory: form.subcategory.trim(),
      tags: form.tags_text
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      brand: form.brand.trim(),
      manufacturer: form.manufacturer.trim(),
      publisher: form.publisher.trim(),
      edition: form.edition.trim(),
      status: form.status,
      fulfillment_method: form.fulfillment_method,
      acquisition_date: form.acquisition_date,
      expiration_date: form.expiration_date,
      weight: form.weight.trim(),
      dimensions: form.dimensions.trim(),
      batch_lot: form.batch_lot.trim(),
      serial_number: form.serial_number.trim(),
      warranty: form.warranty.trim(),
      custom_fields: (form.custom_fields || [])
        .map((row) => ({ label: (row.label || '').trim(), value: (row.value || '').trim() }))
        .filter((row) => row.label || row.value),
      copy_group: form.copy_group.trim(),
      variant_label: form.variant_label.trim(),
      variant_options: (form.variant_options || [])
        .map((row) => ({ name: (row.name || '').trim(), value: (row.value || '').trim() }))
        .filter((row) => row.name || row.value),
      photo_urls: form.photo_urls,
    };
    try {
      const saved = product
        ? await base44.entities.Product.update(product.id, payload)
        : (await createProducts(activeId, [withBusiness(payload, activeId)]))[0];
      onSaved?.(saved);
      onOpenChange(false);
    } catch (err) {
      setError(err?.message || t('productForm.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{product ? t('productForm.editTitle') : t('productForm.newTitle')}</DialogTitle>
          <DialogDescription>
            {t('productForm.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="name">{t('productForm.nameLabel')}</Label>
            <Input id="name" value={form.name} onChange={set('name')} placeholder="The Quiet Year — paperback" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="sku">{t('productForm.skuLabel')}</Label>
              <Input id="sku" value={form.sku} onChange={set('sku')} placeholder="BK-QUIET-01" className="font-mono" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="category">{t('productForm.categoryLabel')}</Label>
              <Input
                id="category"
                list="category-options"
                value={form.category}
                onChange={set('category')}
                placeholder="Fiction"
              />
              <datalist id="category-options">
                {vocabulary.categories.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="isbn">{t('productForm.isbnLabel')}</Label>
              <Input
                id="isbn"
                value={form.isbn}
                onChange={set('isbn')}
                placeholder="978-3-16-148410-0"
                className="font-mono"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="author">{t('productForm.authorLabel')}</Label>
              <Input id="author" value={form.author} onChange={set('author')} placeholder="Ada Mercer" />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="upc">{t('productForm.upcLabel')}</Label>
            <Input id="upc" value={form.upc} onChange={set('upc')} placeholder="081234567890" className="font-mono" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="barcode">{t('productForm.barcodeLabel')}</Label>
              <Input id="barcode" value={form.barcode} onChange={set('barcode')} className="font-mono" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="qr">{t('productForm.qrLabel')}</Label>
              <Input id="qr" value={form.qr_code} onChange={set('qr_code')} className="font-mono" />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>{t('productForm.conditionLabel')}</Label>
            <Select
              value={form.condition || 'unset'}
              onValueChange={(value) => setForm((f) => ({ ...f, condition: value === 'unset' ? '' : value }))}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('productForm.notSet')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unset">{t('productForm.notSet')}</SelectItem>
                {CONDITIONS.map((condition) => (
                  <SelectItem key={condition} value={condition}>
                    {CONDITION_LABELS[condition]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>{t('productForm.photosLabel')}</Label>
            <div className="flex flex-wrap gap-2">
              {form.photo_urls.map((url, index) => (
                <div
                  key={url}
                  className="relative h-16 w-16 overflow-hidden rounded-lg border border-border sm:h-24 sm:w-24"
                >
                  <Image src={url} alt="" fittingType="fill" className="h-full w-full object-cover" />
                  {index === 0 && (
                    <span className="absolute bottom-0 left-0 bg-background/90 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                      {t('productForm.coverBadge')}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setForm((f) => ({ ...f, photo_urls: f.photo_urls.filter((item) => item !== url) }))
                    }
                    className="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-full bg-background/90 text-foreground shadow"
                    aria-label={t('productForm.removePhotoAria')}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}

              {form.photo_urls.length < 6 && (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="grid h-16 w-16 place-items-center rounded-lg border border-dashed border-input text-muted-foreground hover:bg-muted sm:h-24 sm:w-24"
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ImagePlus className="h-4 w-4" />
                  )}
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                addPhotos(Array.from(event.target.files || []));
                event.target.value = '';
              }}
            />
            <p className="text-xs text-muted-foreground">
              {t('productForm.photosHint')}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="cost">{t('productForm.costLabel')}</Label>
              <Input id="cost" type="number" inputMode="decimal" value={form.cost} onChange={set('cost')} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="price">{t('productForm.priceLabel')}</Label>
              <Input id="price" type="number" inputMode="decimal" value={form.price} onChange={set('price')} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="reorder">{t('productForm.reorderLabel')}</Label>
              <Input
                id="reorder"
                type="number"
                inputMode="numeric"
                value={form.reorder_point}
                onChange={set('reorder_point')}
              />
            </div>
          </div>

          <div className="grid gap-3 rounded-lg border border-border p-3">
            <p className="text-sm font-medium">{t('pricing.sectionTitle')}</p>
            {canPricing ? (
              <>
                <div className="grid gap-2">
                  <Label>{t('pricing.modeLabel')}</Label>
                  <Select value={form.pricing_mode} onValueChange={set('pricing_mode')}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="regular">{t('pricing.modeRegular')}</SelectItem>
                      <SelectItem value="clearance">{t('pricing.modeClearance')}</SelectItem>
                      <SelectItem value="rollback">{t('pricing.modeRollback')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.pricing_mode === 'clearance' && (
                  <>
                    <div className="grid gap-2">
                      <Label htmlFor="clearance_price">{t('pricing.clearancePriceLabel')}</Label>
                      <Input
                        id="clearance_price"
                        type="number"
                        inputMode="decimal"
                        value={form.clearance_price}
                        onChange={set('clearance_price')}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">{t('pricing.clearanceHint')}</p>
                  </>
                )}
                {form.pricing_mode === 'rollback' && (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="grid gap-2">
                        <Label htmlFor="sale_price">{t('pricing.salePriceLabel')}</Label>
                        <Input
                          id="sale_price"
                          type="number"
                          inputMode="decimal"
                          value={form.sale_price}
                          onChange={set('sale_price')}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="sale_start">{t('pricing.startLabel')}</Label>
                        <Input
                          id="sale_start"
                          type="date"
                          value={form.sale_start}
                          onChange={set('sale_start')}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="sale_end">{t('pricing.endLabel')}</Label>
                        <Input
                          id="sale_end"
                          type="date"
                          value={form.sale_end}
                          onChange={set('sale_end')}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{t('pricing.rollbackHint')}</p>
                  </>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">{t('pricing.businessOnly')}</p>
            )}
          </div>

          <div className="grid gap-2">
            <Label>{t('productForm.unitLabel')}</Label>
            <Select value={form.unit} onValueChange={set('unit')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['each', 'case', 'pair', 'pack', 'kg'].map((u) => (
                  <SelectItem key={u} value={u}>
                    {UNIT_LABELS[u]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>{t('productForm.supplierLabel')}</Label>
            <Select
              value={form.supplier_id || 'none'}
              onValueChange={(v) => setForm((f) => ({ ...f, supplier_id: v === 'none' ? '' : v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('productForm.notSet')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('productForm.notSet')}</SelectItem>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t('productForm.supplierHint')}
            </p>
          </div>

          <ProductDetailsFields form={form} set={set} setForm={setForm} vocabulary={vocabulary} />

          <div className="grid gap-2">
            <Label htmlFor="notes">{t('productForm.notesLabel')}</Label>
            <Textarea id="notes" value={form.notes} onChange={set('notes')} rows={3} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('productForm.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={saving || uploading}>
            {saving ? t('productForm.saving') : product ? t('productForm.saveChanges') : t('productForm.createProduct')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}