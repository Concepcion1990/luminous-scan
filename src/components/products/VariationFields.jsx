import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Groups one title into copies/variations. Leave the group blank and copies are
 * grouped by ISBN automatically; set it for clothing, stationery sets and other
 * non-book variations.
 */
export default function VariationFields({ form, set, setForm }) {
  const setOption = (index, key) => (event) =>
    setForm((f) => ({
      ...f,
      variant_options: f.variant_options.map((row, i) =>
        i === index ? { ...row, [key]: event.target.value } : row
      ),
    }));

  const removeOption = (index) => () =>
    setForm((f) => ({ ...f, variant_options: f.variant_options.filter((_, i) => i !== index) }));

  return (
    <div className="grid gap-3 rounded-lg border border-border bg-card p-3">
      <div>
        <p className="text-sm font-medium">Copies &amp; variations</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Keep one record per physical copy. Copies sharing an ISBN are grouped automatically.
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="copy_group">Copy group</Label>
        <Input
          id="copy_group"
          value={form.copy_group}
          onChange={set('copy_group')}
          placeholder="Leave blank to group by ISBN"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="variant_label">Variation label</Label>
        <Input
          id="variant_label"
          value={form.variant_label}
          onChange={set('variant_label')}
          placeholder="Large / navy, 2nd printing, gift box"
        />
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <Label>Variation options</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              setForm((f) => ({
                ...f,
                variant_options: [...f.variant_options, { name: '', value: '' }],
              }))
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add
          </Button>
        </div>
        {form.variant_options.length === 0 && (
          <p className="text-xs text-muted-foreground">Size, colour, material, style or packaging.</p>
        )}
        {form.variant_options.map((row, index) => (
          <div key={index} className="flex gap-2">
            <Input
              value={row.name}
              onChange={setOption(index, 'name')}
              placeholder="Size"
              className="h-8 w-[40%]"
            />
            <Input
              value={row.value}
              onChange={setOption(index, 'value')}
              placeholder="Large"
              className="h-8"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground"
              onClick={removeOption(index)}
              aria-label="Remove variation option"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}