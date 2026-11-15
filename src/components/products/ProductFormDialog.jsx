import { useEffect, useRef, useState } from 'react';
import { base44 } from '@/api/client';
import { Camera, ImagePlus, Loader2, ScanBarcode, X } from 'lucide-react';
import { useBusiness } from '@/hooks/useBusiness';
import useEntitlements from '@/hooks/useEntitlements';
import ProductDetailsFields from './ProductDetailsFields';
import { useCatalogVocabulary } from '@/hooks/useCatalogVocabulary';
import { copyGroupKey } from '@/lib/copies';
import { scoped, withBusiness } from '@/lib/scoped';
import { createProducts } from '@/lib/entitlements';
import { findProductsByCode, recordMovement } from '@/lib/inventory';
import { judgeVocabularyValue } from '@/lib/vocabulary';
import BarcodeScanner from '@/components/scan/BarcodeScanner';
import VocabularyCombobox from './VocabularyCombobox';
import AddVocabularyInline from './AddVocabularyInline';
import { Image } from '@/components/ui/image';
import { t } from '@/lib/i18n';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import AddLocationInline from '@/components/locations/AddLocationInline';
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
  const { activeId, user } = useBusiness();
  // Clearance + rollback pricing is Business-only (migration 018).
  // Off-Business the section is a locked note AND the submit payload
  // omits the pricing fields entirely: an unrelated edit must never
  // erase pricing a downgraded business is holding (the server also
  // refuses pricing writes off-Business and strips them from reads).
  const { can } = useEntitlements();
  const canPricing = can('pricing');
  // Suppliers are Business-only too (the entity is plan-gated): off
  // Business the field shows the same polite note as sale pricing,
  // and the payload omits supplier_id/supplier_name entirely, so a
  // downgraded business's stored supplier is held untouched.
  const canSuppliers = can('suppliers');
  const vocabulary = useCatalogVocabulary(open ? activeId : '');
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [suppliers, setSuppliers] = useState([]);
  // Quantity on hand (Nov 14, 2026): on CREATE it is the starting
  // quantity — how many the owner has right now, stocked as a
  // 'receive' movement the moment the product is created, one act
  // instead of create-then-go-Receive. On EDIT (owner ruling, later
  // the same day) the same box shows the CURRENT count at the
  // chosen location, and saving a changed count writes the
  // difference as ONE real movement ('receive' up, 'correction'
  // down) through the same funnel — the typed number never
  // silently overwrites stock; the movement is the record.
  const [quantity, setQuantity] = useState('');
  const [locations, setLocations] = useState([]);
  const [quantityLocationId, setQuantityLocationId] = useState('');
  // Edit mode: the product's stock levels, loaded on open so the
  // quantity box can prefill the current count per location.
  const [editLevels, setEditLevels] = useState([]);
  const [editLevelsLoaded, setEditLevelsLoaded] = useState(false);
  const prefillKeyRef = useRef('');
  const [createdProduct, setCreatedProduct] = useState(null);
  const [openingStockDone, setOpeningStockDone] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const cameraFileRef = useRef(null);
  // Photos: tapping the add tile offers camera OR gallery (owner
  // ruling, Nov 14, 2026 — the tile used to open the gallery
  // picker only, with no way to photograph the product on the
  // spot). Both choices feed the same addPhotos pipeline.
  const [photoChooserOpen, setPhotoChooserOpen] = useState(false);
  // In-form code scanner (Nov 14, 2026): the UPC and Barcode fields
  // each get a Scan button that opens the camera scanner as an overlay
  // INSIDE this dialog — the form never unmounts, so a half-filled
  // form keeps every value. scanField names the field the scanner is
  // filling; codeTaken carries the at-field notice when a captured
  // code already belongs to another product.
  const [scanField, setScanField] = useState(null);
  const [codeTaken, setCodeTaken] = useState(null);
  const scanHandledRef = useRef(false);
  // Vocabulary pickers (Nov 14, 2026): which field's "Add new …"
  // inline form is open, and the names created through it during
  // this session (sanctioned values for the save guard even before
  // the vocabulary refetch lands).
  const [addNewField, setAddNewField] = useState(null);
  const [addedNames, setAddedNames] = useState({ category: [], subcategory: [] });
  const initialCategoryRef = useRef('');
  const initialSubcategoryRef = useRef('');

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
    // The category/subcategory the form opened with. The save guard
    // grandfathers these: they are not new births, even if the
    // managed list no longer carries them.
    initialCategoryRef.current = (product?.category || seed?.category || '').trim();
    initialSubcategoryRef.current = (product?.subcategory || seed?.subcategory || '').trim();
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
    base44.entities.Location
      .filter(scoped({}, activeId), { sort: 'name', limit: 100 })
      .then((page) => {
        const list = page.items ?? [];
        setLocations(list);
        // The scan flow's own rule: the remembered location wins,
        // else the first location (locations load sorted by name).
        let remembered = null;
        try {
          remembered = localStorage.getItem('stockroom.location');
        } catch {
          remembered = null;
        }
        setQuantityLocationId((current) =>
          list.find((l) => l.id === current)
            ? current
            : list.find((l) => l.id === remembered)?.id || list[0]?.id || '',
        );
      });
  }, [open, activeId]);

  useEffect(() => {
    if (open) {
      setQuantity('');
      setCreatedProduct(null);
      setOpeningStockDone(false);
      setPhotoChooserOpen(false);
      setScanField(null);
      setCodeTaken(null);
      setAddNewField(null);
      setAddedNames({ category: [], subcategory: [] });
      setEditLevels([]);
      setEditLevelsLoaded(false);
      prefillKeyRef.current = '';
    }
  }, [open, product, seed, defaultCode]);

  // Edit mode: load the product's levels so the quantity box can
  // prefill the current on-hand at the chosen location.
  useEffect(() => {
    if (!open || !product) return;
    base44.entities.StockLevel
      .filter(scoped({ product_id: product.id }, activeId), { limit: 500 })
      .then((page) => {
        setEditLevels(page.items ?? []);
        setEditLevelsLoaded(true);
      });
  }, [open, product, activeId]);

  // Prefill the edit quantity box with the current count at the
  // chosen location — once per (product, location) pair, so
  // switching the location re-reads that location's count without
  // ever stomping a number the owner is mid-typing at one place.
  useEffect(() => {
    if (!open || !product || !editLevelsLoaded) return;
    const key = `${product.id}|${quantityLocationId}`;
    if (prefillKeyRef.current === key) return;
    prefillKeyRef.current = key;
    const current =
      editLevels.find((l) => l.location_id === quantityLocationId)?.quantity ?? 0;
    setQuantity(String(current));
  }, [open, product, editLevelsLoaded, editLevels, quantityLocationId]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e?.target ? e.target.value : e }));

  // A category/subcategory born through the picker's "Add new" row:
  // select it, sanction it for the save guard (the vocabulary
  // refetch lands a moment later), and close the inline form.
  const handleVocabularyCreated = (field, name) => {
    set(field)(name);
    setAddedNames((prev) => ({ ...prev, [field]: [...prev[field], name] }));
    setAddNewField(null);
  };

  // Open the in-form scanner for one code field. The camera overlay
  // lives inside this dialog, so opening or closing it never touches
  // the form state — everything already typed stays typed.
  const openCodeScanner = (field) => {
    scanHandledRef.current = false;
    setScanField(field);
  };

  // A capture lands in the field the scanner was opened from, the
  // overlay closes, and focus returns to that field. The scanner
  // re-arms itself after a capture, so the first capture is latched
  // and any repeat detect while the overlay closes is ignored. If
  // the code already belongs to ANOTHER product in this business,
  // the field says so plainly (one code points to one product)
  // instead of the save quietly making a second record for it.
  const handleScanDetect = async (raw) => {
    if (scanHandledRef.current || !scanField) return;
    scanHandledRef.current = true;
    const field = scanField;
    const value = String(raw || '').trim();
    setScanField(null);
    if (!value) return;
    set(field)(value);
    requestAnimationFrame(() => document.getElementById(field)?.focus());
    try {
      const matches = await findProductsByCode(value, activeId || '');
      const other = matches.find((m) => m.id !== product?.id);
      setCodeTaken(other ? { field, name: other.name } : null);
    } catch {
      // The lookup failing must never eat the scanned code — the
      // field already has it; only the courtesy notice is skipped.
    }
  };

  const addPhotos = async (files) => {
    if (!files?.length) return;
    // The failure shows HERE, at the photos field — the old code set
    // the form-level error, far from the field, and the owner never
    // saw why her photo "didn't take" (Nov 14, 2026). The only
    // client-side refusal is a file that is not an image at all:
    // size is NEVER the customer's problem — UploadPublicFile
    // downscales and re-encodes the photo for them before upload.
    setPhotoError('');
    for (const file of files) {
      if (!file.type?.startsWith('image/')) {
        setPhotoError(t('productForm.uploadFailed'));
        return;
      }
    }
    setUploading(true);
    try {
      const urls = [];
      for (const file of files) {
        const { file_url } = await base44.integrations.Core.UploadPublicFile({ file });
        urls.push(file_url);
      }
      setForm((f) => ({ ...f, photo_urls: [...f.photo_urls, ...urls].slice(0, 6) }));
    } catch (err) {
      setPhotoError(err?.message || t('productForm.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    // Only the name is required (Nov 14, 2026): a SKU is optional —
    // the server generates one from the name when the field is left
    // blank (a barcode scan fills name + UPC, not a SKU). The old
    // combined message also lied, claiming the name was missing
    // when only the SKU was; the message now names only what is
    // actually missing.
    if (!form.name.trim()) {
      setError(t('productForm.nameRequired'));
      return;
    }
    // No silent category births (owner ruling, Nov 14, 2026) — the
    // decision lives in judgeVocabularyValue (src/lib/vocabulary.js);
    // here the form only shows the plain message and stops.
    const categoryVerdict = judgeVocabularyValue({
      typedRaw: form.category,
      initial: initialCategoryRef.current,
      options: vocabulary.categories,
      sanctioned: addedNames.category,
      loaded: vocabulary.loaded,
    });
    if (!categoryVerdict.ok) {
      setError(t('productForm.categoryNotFound'));
      return;
    }
    const subcategoryVerdict = judgeVocabularyValue({
      typedRaw: form.subcategory,
      initial: initialSubcategoryRef.current,
      options: vocabulary.subcategories,
      sanctioned: addedNames.subcategory,
      loaded: vocabulary.loaded,
    });
    if (!subcategoryVerdict.ok) {
      setError(t('productForm.subcategoryNotFound'));
      return;
    }
    // Starting quantity validation (create mode only): blank means
    // zero; anything else must be a whole number of zero or more.
    const effectiveProduct = product || createdProduct;
    let startQty = 0;
    if (!product) {
      const raw = quantity.trim();
      if (raw !== '') {
        if (!/^\d+$/.test(raw)) {
          setError(t('productForm.quantityInvalid'));
          return;
        }
        startQty = Number(raw);
      }
      // Stock needs somewhere to sit: refuse BEFORE creating
      // anything when there is no location at all (the inline add
      // door in the quantity block is the way out).
      if (startQty > 0 && locations.length === 0) {
        setError(t('inventory.chooseLocation'));
        return;
      }
    }
    // Edit-mode quantity validation: the box is prefilled with the
    // current count, so blank means "leave it as it is" (never a
    // silent zero); anything typed must be a whole number of zero
    // or more, with the same plain message as create.
    let editQty = null;
    if (product) {
      const raw = quantity.trim();
      if (raw !== '') {
        if (!/^\d+$/.test(raw)) {
          setError(t('productForm.quantityInvalid'));
          return;
        }
        editQty = Number(raw);
      }
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
      category: categoryVerdict.value,
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
      ...(canSuppliers
        ? {
            supplier_id: form.supplier_id,
            supplier_name: suppliers.find((s) => s.id === form.supplier_id)?.name || '',
          }
        : {}),
      notes: form.notes.trim(),
      barcode: form.barcode.trim(),
      qr_code: form.qr_code.trim(),
      description: form.description.trim(),
      subcategory: subcategoryVerdict.value,
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
      const saved = effectiveProduct
        ? await base44.entities.Product.update(effectiveProduct.id, payload)
        : (await createProducts(activeId, [withBusiness(payload, activeId)]))[0];
      if (!effectiveProduct) {
        // Remember the create landed: if the opening movement ever
        // failed, a retry updates this product instead of making a
        // duplicate.
        setCreatedProduct(saved);
      }
      if (!product && startQty > 0 && !openingStockDone) {
        const location = locations.find((l) => l.id === quantityLocationId) || locations[0];
        if (location) {
          await recordMovement({
            product: saved,
            location,
            type: 'receive',
            quantity: startQty,
            businessId: activeId,
            user,
          });
          setOpeningStockDone(true);
        }
      }
      if (product && editQty !== null) {
        // The typed count differs from the count the box was
        // prefilled with → ONE movement carries the difference:
        // 'receive' of the difference up, 'correction' landing
        // exactly on the typed count down. Unchanged → no movement
        // at all. recordMovement re-reads the live level and can
        // never take stock below zero.
        const location = locations.find((l) => l.id === quantityLocationId) || locations[0];
        const currentAtLocation = location
          ? editLevels.find((l) => l.location_id === location.id)?.quantity ?? 0
          : 0;
        if (location && editQty !== currentAtLocation) {
          if (editQty > currentAtLocation) {
            await recordMovement({
              product: saved,
              location,
              type: 'receive',
              quantity: editQty - currentAtLocation,
              businessId: activeId,
              user,
            });
          } else {
            await recordMovement({
              product: saved,
              location,
              type: 'correction',
              quantity: editQty,
              businessId: activeId,
              user,
            });
          }
        }
      }
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
              <VocabularyCombobox
                id="category"
                value={form.category}
                onChange={set('category')}
                options={vocabulary.categories}
                placeholder="Fiction"
                label={t('productForm.categoryLabel')}
                addNewLabel={t('productForm.addNewCategory')}
                onAddNewRequest={() => setAddNewField('category')}
              />
              {addNewField === 'category' && (
                <AddVocabularyInline
                  businessId={activeId}
                  kind="category"
                  initialName={form.category}
                  existingNames={vocabulary.categories}
                  title={t('productForm.addNewCategory')}
                  onCreated={(name) => handleVocabularyCreated('category', name)}
                  onCancel={() => setAddNewField(null)}
                />
              )}
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
            <div className="flex gap-2">
              <Input
                id="upc"
                value={form.upc}
                onChange={(e) => {
                  set('upc')(e);
                  if (codeTaken?.field === 'upc') setCodeTaken(null);
                }}
                placeholder="081234567890"
                className="min-w-0 flex-1 font-mono"
              />
              <Button type="button" variant="outline" className="shrink-0" onClick={() => openCodeScanner('upc')}>
                <ScanBarcode className="mr-1.5 h-4 w-4" /> {t('productForm.scanCode')}
              </Button>
            </div>
            {codeTaken?.field === 'upc' && (
              <p className="text-xs font-medium text-destructive">
                {t('productForm.codeTakenNotice', { name: codeTaken.name })}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="barcode">{t('productForm.barcodeLabel')}</Label>
              <div className="flex gap-2">
                <Input
                  id="barcode"
                  value={form.barcode}
                  onChange={(e) => {
                    set('barcode')(e);
                    if (codeTaken?.field === 'barcode') setCodeTaken(null);
                  }}
                  className="min-w-0 flex-1 font-mono"
                />
                <Button type="button" variant="outline" className="shrink-0" onClick={() => openCodeScanner('barcode')} aria-label={t('productForm.scanCode')}>
                  <ScanBarcode className="h-4 w-4" />
                </Button>
              </div>
              {codeTaken?.field === 'barcode' && (
                <p className="text-xs font-medium text-destructive">
                  {t('productForm.codeTakenNotice', { name: codeTaken.name })}
                </p>
              )}
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
                  onClick={() => setPhotoChooserOpen(true)}
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
            {photoChooserOpen && form.photo_urls.length < 6 && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPhotoChooserOpen(false);
                    cameraFileRef.current?.click();
                  }}
                >
                  <Camera className="mr-1.5 h-3.5 w-3.5" /> {t('productForm.takePhoto')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPhotoChooserOpen(false);
                    fileRef.current?.click();
                  }}
                >
                  <ImagePlus className="mr-1.5 h-3.5 w-3.5" /> {t('productForm.chooseFromGallery')}
                </Button>
              </div>
            )}
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
            <input
              ref={cameraFileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(event) => {
                addPhotos(Array.from(event.target.files || []));
                event.target.value = '';
              }}
            />
            {photoError && (
              <p className="text-xs font-medium text-destructive" role="alert">{photoError}</p>
            )}
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

          {!product && !createdProduct && (
            <div className="grid gap-3 rounded-lg border border-border p-3">
              <div className="grid gap-2">
                <Label htmlFor="start_quantity">{t('productForm.quantityLabel')}</Label>
                <Input
                  id="start_quantity"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground">{t('productForm.quantityHint')}</p>
              </div>
              {locations.length > 1 && (
                <div className="grid gap-2">
                  <Label>{t('inventory.locationLabel')}</Label>
                  <Select value={quantityLocationId} onValueChange={setQuantityLocationId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {locations.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {locations.length === 0 && (
                <AddLocationInline
                  businessId={activeId}
                  onCreated={(place) => {
                    setLocations([place]);
                    setQuantityLocationId(place.id);
                  }}
                />
              )}
            </div>
          )}

          {product && locations.length > 0 && (
            <div className="grid gap-3 rounded-lg border border-border p-3">
              <div className="grid gap-2">
                <Label htmlFor="edit_quantity">{t('productForm.quantityLabel')}</Label>
                <Input
                  id="edit_quantity"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t('productForm.quantityEditHint')}</p>
              </div>
              {locations.length > 1 && (
                <div className="grid gap-2">
                  <Label>{t('inventory.locationLabel')}</Label>
                  <Select value={quantityLocationId} onValueChange={setQuantityLocationId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {locations.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

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
            {canSuppliers ? (
              <>
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
              </>
            ) : (
              <p className="text-xs text-muted-foreground">{t('productForm.supplierBusinessOnly')}</p>
            )}
          </div>

          <ProductDetailsFields
            form={form}
            set={set}
            setForm={setForm}
            vocabulary={vocabulary}
            businessId={activeId}
            addNewField={addNewField}
            setAddNewField={setAddNewField}
            onVocabularyCreated={handleVocabularyCreated}
          />

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

        {/* In-form scanner overlay: rendered INSIDE the dialog, so
            the form underneath never unmounts and nothing typed is
            lost. Closing it (capture or Cancel) returns to the exact
            same half-filled form. */}
        {scanField && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-sm space-y-3 rounded-xl bg-card p-4 shadow-lg">
              <BarcodeScanner onDetect={handleScanDetect} />
              <Button type="button" variant="outline" className="w-full" onClick={() => setScanField(null)}>
                {t('productForm.cancel')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}