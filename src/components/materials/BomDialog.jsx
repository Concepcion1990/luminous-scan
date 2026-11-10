import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { base44 } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { useBusiness } from '@/hooks/useBusiness';
import { withBusiness } from '@/lib/scoped';
import { BUILD_KINDS } from '@/lib/bom';

const EMPTY_LINE = { component_id: '', component_name: '', sku: '', quantity: 1 };

export default function BomDialog({ open, onOpenChange, bom, products, boms, onSaved }) {
  const { activeId } = useBusiness();
  const [productId, setProductId] = useState('');
  const [kind, setKind] = useState('bundle');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([{ ...EMPTY_LINE }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setProductId(bom?.product_id || '');
    setKind(bom?.kind || 'bundle');
    setNotes(bom?.notes || '');
    setLines(
      bom?.lines?.length ? bom.lines.map((line) => ({ ...EMPTY_LINE, ...line })) : [{ ...EMPTY_LINE }]
    );
    setError('');
  }, [open, bom]);

  const product = products.find((p) => p.id === productId);

  const setLine = (index, patch) =>
    setLines((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const chooseComponent = (index, id) => {
    const component = products.find((p) => p.id === id);
    setLine(index, {
      component_id: id,
      component_name: component?.name || '',
      sku: component?.sku || '',
    });
  };

  const save = async () => {
    setError('');
    if (!product) {
      setError('Choose the product you are building.');
      return;
    }
    const clean = lines
      .filter((line) => line.component_id && Number(line.quantity) > 0)
      .map((line) => ({ ...line, quantity: Number(line.quantity) }));
    if (!clean.length) {
      setError('Add at least one component with a quantity.');
      return;
    }
    if (new Set(clean.map((line) => line.component_id)).size !== clean.length) {
      setError('Each component can only appear once — raise its quantity instead.');
      return;
    }
    if (clean.some((line) => line.component_id === productId)) {
      setError('The product being built cannot also be one of its own components.');
      return;
    }
    const clash = boms.find((b) => b.product_id === productId && b.id !== bom?.id);
    if (clash) {
      setError(`“${product.name}” already has a build list (${clash.kind}). Edit that one instead.`);
      return;
    }

    setSaving(true);
    try {
      const values = withBusiness(
        {
          product_id: product.id,
          product_name: product.name,
          sku: product.sku || '',
          kind,
          lines: clean,
          notes,
          active: true,
        },
        activeId
      );
      if (bom) await base44.entities.Bom.update(bom.id, values);
      else await base44.entities.Bom.create(values);
      onOpenChange(false);
      onSaved(bom ? `${product.name}: build list saved.` : `${product.name}: build list created.`);
    } catch (e) {
      setError(e.message || 'Could not save this build list.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{bom ? 'Edit build list' : 'New build list'}</DialogTitle>
          <DialogDescription>
            A bundle packs existing products together. A recipe lists the materials a made item uses up.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label className="text-xs">Product you build</Label>
            <Select
              value={productId || 'none'}
              onValueChange={(v) => setProductId(v === 'none' ? '' : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a product" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Choose a product</SelectItem>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.sku ? `${p.name} · ${p.sku}` : p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1">
            <Label className="text-xs">Kind of build</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(BUILD_KINDS).map(([key, meta]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setKind(key)}
                  className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                    kind === key
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  <span className="block text-sm font-medium">{meta.label}</span>
                  <span
                    className={`block text-[11px] ${
                      kind === key ? 'text-primary-foreground/65' : 'text-muted-foreground'
                    }`}
                  >
                    {meta.blurb}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Components</Label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setLines((rows) => [...rows, { ...EMPTY_LINE }])}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Add part
              </Button>
            </div>

            <div className="space-y-2">
              {lines.map((line, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Select
                    value={line.component_id || 'none'}
                    onValueChange={(v) => chooseComponent(index, v === 'none' ? '' : v)}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Choose a product or material" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Choose a product</SelectItem>
                      {products
                        .filter((p) => p.id !== productId)
                        .map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.sku ? `${p.name} · ${p.sku}` : p.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={line.quantity}
                    onChange={(e) => setLine(index, { quantity: e.target.value })}
                    className="numeric w-20"
                    aria-label="Quantity per unit built"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="shrink-0 text-muted-foreground"
                    onClick={() => setLines((rows) => rows.filter((_, i) => i !== index))}
                    aria-label="Remove component"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Quantities are per one unit built. Materials can be any catalog product, including those sold
              by weight or case.
            </p>
          </div>

          <div className="grid gap-1">
            <Label className="text-xs">Notes</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Assembly notes, supplier, packaging…"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save build list'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}