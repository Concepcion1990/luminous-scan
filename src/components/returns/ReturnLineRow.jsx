import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CONDITIONS, lineValue } from '@/lib/returns';
import { money } from '@/lib/purchasing';

export default function ReturnLineRow({ line, kind, products, currency, onChange, onRemove }) {
  const isReturn = kind === 'return';
  const pickProduct = (id) => {
    const product = products.find((p) => p.id === id);
    onChange({
      product_id: id,
      product_name: product?.name || '',
      sku: product?.sku || '',
      unit_price: line.unit_price === '' ? product?.price ?? '' : line.unit_price,
    });
  };

  return (
    <div className="space-y-2 rounded-lg border border-border p-2.5">
      <div className="flex items-start gap-2">
        <Select value={line.product_id || 'none'} onValueChange={(v) => pickProduct(v === 'none' ? '' : v)}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Choose a product" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Choose a product</SelectItem>
            {products.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name} · {p.sku}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={onRemove} aria-label="Remove line">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="grid gap-1">
          <Label className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Qty</Label>
          <Input
            type="number"
            inputMode="numeric"
            min="1"
            value={line.quantity}
            onChange={(e) => onChange({ quantity: e.target.value })}
          />
        </div>
        <div className="grid gap-1">
          <Label className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Price</Label>
          <Input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={line.unit_price}
            onChange={(e) => onChange({ unit_price: e.target.value })}
          />
        </div>
        <div className="grid gap-1">
          <Label className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Value</Label>
          <p className="numeric flex h-9 items-center text-sm font-medium">{money(lineValue(line), currency)}</p>
        </div>
      </div>

      {isReturn && (
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1">
            <Label className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Condition
            </Label>
            <Select
              value={line.condition}
              onValueChange={(v) =>
                onChange({
                  condition: v,
                  // Damaged or unsellable goods must never be queued for the shelf
                  // by default — the owner has to opt back in deliberately.
                  ...(v === 'damaged' || v === 'unsellable' ? { restock: false } : {}),
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONDITIONS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Back into stock
            </Label>
            <Select
              value={line.restock ? 'yes' : 'no'}
              onValueChange={(v) => onChange({ restock: v === 'yes' })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">Restock it</SelectItem>
                <SelectItem value="no">Do not restock</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}