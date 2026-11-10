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
import { lineTotal } from '@/lib/orders';
import { money } from '@/lib/purchasing';
import { t } from '@/lib/i18n';

export default function OrderLineRow({ line, products, currency, onChange, onRemove }) {
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
            <SelectValue placeholder={t('orders.chooseProduct')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t('orders.chooseProduct')}</SelectItem>
            {products.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name} · {p.sku}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={onRemove} aria-label={t('orders.removeLine')}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="grid gap-1">
          <Label className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{t('orders.qty')}</Label>
          <Input
            type="number"
            inputMode="numeric"
            min="1"
            value={line.quantity}
            onChange={(e) => onChange({ quantity: e.target.value })}
          />
        </div>
        <div className="grid gap-1">
          <Label className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{t('orders.price')}</Label>
          <Input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={line.unit_price}
            onChange={(e) => onChange({ unit_price: e.target.value })}
          />
        </div>
        <div className="grid gap-1">
          <Label className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{t('orders.line')}</Label>
          <p className="numeric flex h-9 items-center text-sm font-medium">{money(lineTotal(line), currency)}</p>
        </div>
      </div>
    </div>
  );
}