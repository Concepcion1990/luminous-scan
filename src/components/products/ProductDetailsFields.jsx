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

const STATUSES = [
  { value: 'active', label: 'Active — sellable' },
  { value: 'draft', label: 'Draft' },
  { value: 'archived', label: 'Archived' },
  { value: 'discontinued', label: 'Discontinued' },
];

const FULFILLMENT = [
  { value: 'owner_stocked', label: 'Owner stocked' },
  { value: 'made_to_order', label: 'Made to order' },
  { value: 'supplier_fulfilled', label: 'Supplier fulfilled' },
  { value: 'print_on_demand', label: 'Print on demand' },
  { value: 'digital', label: 'Digital' },
];

/** The optional half of the product form: kept folded away so entry stays quick. */
export default function ProductDetailsFields({ form, set, setForm, vocabulary = {} }) {
  const [open, setOpen] = useState(false);

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
        <span>More details</span>
        <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
          {open ? 'Hide' : 'Brand, tags, status, dates'}
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </span>
      </button>

      {open && (
        <div className="grid gap-4 rounded-lg border border-border/70 bg-muted/30 p-3">
          <VariationFields form={form} set={set} setForm={setForm} />

          <div className="grid gap-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={form.description}
              onChange={set('description')}
              rows={2}
              placeholder="What this item is, in a line or two"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="brand">Brand</Label>
              <Input id="brand" value={form.brand} onChange={set('brand')} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="manufacturer">Manufacturer</Label>
              <Input id="manufacturer" value={form.manufacturer} onChange={set('manufacturer')} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="publisher">Publisher</Label>
              <Input id="publisher" value={form.publisher} onChange={set('publisher')} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edition">Edition</Label>
              <Input id="edition" value={form.edition} onChange={set('edition')} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="subcategory">Subcategory</Label>
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
              <Label htmlFor="tags">Tags</Label>
              <Input
                id="tags"
                value={form.tags_text}
                onChange={set('tags_text')}
                placeholder="signed, gift, series"
              />
              {vocabulary.tags?.length > 0 && (
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Saved tags: {vocabulary.tags.join(', ')}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Status</Label>
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
              <Label>Fulfillment</Label>
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
              <Label htmlFor="acquired">Acquired on</Label>
              <Input
                id="acquired"
                type="date"
                value={form.acquisition_date}
                onChange={set('acquisition_date')}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="expires">Expires on</Label>
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
              <Label htmlFor="batch">Batch / lot</Label>
              <Input id="batch" value={form.batch_lot} onChange={set('batch_lot')} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="serial">Serial number</Label>
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
              <Label htmlFor="weight">Weight</Label>
              <Input id="weight" value={form.weight} onChange={set('weight')} placeholder="320 g" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="dimensions">Dimensions</Label>
              <Input
                id="dimensions"
                value={form.dimensions}
                onChange={set('dimensions')}
                placeholder="21 × 14 × 2 cm"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="warranty">Warranty</Label>
            <Input id="warranty" value={form.warranty} onChange={set('warranty')} placeholder="90 days" />
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>Custom fields</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setForm((f) => ({ ...f, custom_fields: [...f.custom_fields, { label: '', value: '' }] }))
                }
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Add
              </Button>
            </div>
            {form.custom_fields.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Your own fields — shelf, grade, vendor code, anything you track.
              </p>
            )}
            {form.custom_fields.map((row, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  value={row.label}
                  onChange={setCustom(index, 'label')}
                  placeholder="Label"
                  className="h-8 w-[40%]"
                />
                <Input
                  value={row.value}
                  onChange={setCustom(index, 'value')}
                  placeholder="Value"
                  className="h-8"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground"
                  onClick={removeCustom(index)}
                  aria-label="Remove field"
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