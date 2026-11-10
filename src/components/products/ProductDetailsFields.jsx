import { useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import VariationFields from './VariationFields';
import { t } from '@/lib/i18n';


/** The optional half of the product form: kept folded away so entry stays quick. */
export default function ProductDetailsFields({ form, set, setForm, vocabulary = {} }) {
  const [open, setOpen] = useState(false);

  const STATUSES = [
    { value: 'active', label: t('productForm.statusActiveSellable') },
    { value: 'draft', label: t('productForm.statusDraft') },
    { value: 'archived', label: t('productForm.statusArchived') },
    { value: 'discontinued', label: t('productForm.statusDiscontinued') },
  ];

  const FULFILLMENT = [
    { value: 'owner_stocked', label: t('productForm.fulfillOwnerStocked') },
    { value: 'made_to_order', label: t('productForm.fulfillMadeToOrder') },
    { value: 'supplier_fulfilled', label: t('productForm.fulfillSupplier') },
    { value: 'print_on_demand', label: t('productForm.fulfillPrintOnDemand') },
    { value: 'digital', label: t('productForm.fulfillDigital') },
  ];

  const setCustom = (index, key) => (event) =>
    setForm((f) => ({
      ...f,
      custom_fields: f.custom_fields.map((row, i) =>
        i === index ? { ...row, [key]: event.target.value } : row
      ),
    }));

  const removeCustom = (index) => () =>
    setForm((f) => ({ ...f, custom_fields: f.custom_fields.filter((_, i) => i !== index) }));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted/60"
      >
        <span>{t('productForm.moreDetails')}</span>
        <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
          {open ? t('productForm.hideDetails') : t('productForm.moreDetailsHint')}
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </span>
      </button>

      {open && (
        <div className="grid gap-4 rounded-lg border border-border/70 bg-muted/30 p-3">
          <VariationFields form={form} set={set} setForm={setForm} />

          <div className="grid gap-2">
            <Label htmlFor="description">{t('productForm.descriptionLabel')}</Label>
            <Textarea
              id="description"
              value={form.description}
              onChange={set('description')}
              rows={2}
              placeholder={t('productForm.descriptionPlaceholder')}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="brand">{t('productForm.brandLabel')}</Label>
              <Input id="brand" value={form.brand} onChange={set('brand')} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="manufacturer">{t('productForm.manufacturerLabel')}</Label>
              <Input id="manufacturer" value={form.manufacturer} onChange={set('manufacturer')} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="publisher">{t('productForm.publisherLabel')}</Label>
              <Input id="publisher" value={form.publisher} onChange={set('publisher')} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edition">{t('productForm.editionLabel')}</Label>
              <Input id="edition" value={form.edition} onChange={set('edition')} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="subcategory">{t('productForm.subcategoryLabel')}</Label>
              <Input
                id="subcategory"
                list="subcategory-options"
                value={form.subcategory}
                onChange={set('subcategory')}
              />
              <datalist id="subcategory-options">
                {(vocabulary.subcategories || []).map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tags">{t('productForm.tagsLabel')}</Label>
              <Input
                id="tags"
                value={form.tags_text}
                onChange={set('tags_text')}
                placeholder="signed, gift, series"
              />
              {vocabulary.tags?.length > 0 && (
                <p className="text-[11px] leading-snug text-muted-foreground">
                  {t('productForm.savedTags', { tags: vocabulary.tags.join(', ') })}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>{t('productForm.statusLabel')}</Label>
              <Select value={form.status} onValueChange={set('status')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>{t('productForm.fulfillmentLabel')}</Label>
              <Select value={form.fulfillment_method} onValueChange={set('fulfillment_method')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FULFILLMENT.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="acquired">{t('productForm.acquiredLabel')}</Label>
              <Input
                id="acquired"
                type="date"
                value={form.acquisition_date}
                onChange={set('acquisition_date')}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="expires">{t('productForm.expiresLabel')}</Label>
              <Input
                id="expires"
                type="date"
                value={form.expiration_date}
                onChange={set('expiration_date')}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="batch">{t('productForm.batchLabel')}</Label>
              <Input id="batch" value={form.batch_lot} onChange={set('batch_lot')} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="serial">{t('productForm.serialLabel')}</Label>
              <Input
                id="serial"
                value={form.serial_number}
                onChange={set('serial_number')}
                className="font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="weight">{t('productForm.weightLabel')}</Label>
              <Input id="weight" value={form.weight} onChange={set('weight')} placeholder="320 g" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="dimensions">{t('productForm.dimensionsLabel')}</Label>
              <Input
                id="dimensions"
                value={form.dimensions}
                onChange={set('dimensions')}
                placeholder="21 × 14 × 2 cm"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="warranty">{t('productForm.warrantyLabel')}</Label>
            <Input id="warranty" value={form.warranty} onChange={set('warranty')} placeholder="90 days" />
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>{t('productForm.customFieldsLabel')}</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setForm((f) => ({ ...f, custom_fields: [...f.custom_fields, { label: '', value: '' }] }))
                }
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> {t('productForm.addButton')}
              </Button>
            </div>
            {form.custom_fields.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {t('productForm.customFieldsHint')}
              </p>
            )}
            {form.custom_fields.map((row, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  value={row.label}
                  onChange={setCustom(index, 'label')}
                  placeholder={t('productForm.customLabelPlaceholder')}
                  className="h-8 w-[40%]"
                />
                <Input
                  value={row.value}
                  onChange={setCustom(index, 'value')}
                  placeholder={t('productForm.customValuePlaceholder')}
                  className="h-8"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground"
                  onClick={removeCustom(index)}
                  aria-label={t('productForm.removeFieldAria')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}