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
import { lineTotal, money } from '@/lib/purchasing';

export default function OrderLineRow({ line, products, currency, onChange, onRemove }) {
  const pickProduct = (id) => {
    const product = products.find((p) => p.id === id);
    onChange({
      product_id: id,
      product_name: product?.name || '',
      sku: product?.sku || '',
      unit_cost: line.unit_cost === '' ? product?.cost ?? '' : line.unit_cost,
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
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={onRemove}
          aria-label="Remove line"
        >
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
            value={line.qty_ordered}
            onChange={(e) => onChange({ qty_ordered: e.target.value })}
          />
        </div>
        <div className="grid gap-1">
          <Label className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Unit cost
          </Label>
          <Input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={line.unit_cost}
            onChange={(e) => onChange({ unit_cost: e.target.value })}
          />
        </div>
        <div className="grid gap-1">
          <Label className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Line</Label>
          <p className="numeric flex h-9 items-center text-sm font-medium">{money(lineTotal(line), currency)}</p>
        </div>
      </div>
    </div>
  );
}