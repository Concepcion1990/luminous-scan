import { Minus, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export default function QuantityStepper({ value, onChange, min = 0, allowZero = false }) {
  const num = Number(value) || 0;
  const floor = allowZero ? 0 : Math.max(min, 1);

  const step = (delta) => onChange(String(Math.max(floor, num + delta)));

  return (
    <div className="flex items-center gap-1.5">
      <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={() => step(-1)}>
        <Minus className="h-4 w-4" />
      </Button>
      <Input
        type="number"
        inputMode="numeric"
        value={value}
        min={floor}
        onChange={(e) => onChange(e.target.value)}
        className="numeric h-10 text-center text-base font-semibold"
      />
      <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={() => step(1)}>
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}