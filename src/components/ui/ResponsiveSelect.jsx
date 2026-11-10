import { useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import useIsDesktop from '@/hooks/useIsDesktop';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { cn } from '@/lib/utils';

/**
 * Controlled, single-choice select.
 * Radix retains its existing desktop dropdown. On narrow viewports Vaul
 * displays the same choices as an accessible, safe-area-aware bottom sheet.
 * This component does not modify the shared Radix Select implementation.
 */
export default function ResponsiveSelect({
  value,
  onValueChange,
  options = [],
  title = 'Choose an option',
  placeholder = 'Select an option',
  className,
  disabled = false,
  ariaLabel,
}) {
  const isDesktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  const display = selected?.label ?? placeholder;
  const accessibleLabel = ariaLabel || title;

  if (isDesktop) {
    return (
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger className={className} aria-label={accessibleLabel}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Drawer open={open} onOpenChange={setOpen} shouldScaleBackground={false}>
      <DrawerTrigger asChild>
        <button
          type="button"
          aria-label={accessibleLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={disabled}
          data-pull-refresh-ignore
          className={cn(
            'flex min-h-11 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-left text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
            className
          )}
        >
          <span className={cn('min-w-0 truncate', !selected && 'text-muted-foreground')}>
            {display}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" aria-hidden="true" />
        </button>
      </DrawerTrigger>
      <DrawerContent
        className="max-h-[85dvh] rounded-t-2xl border-border bg-background text-foreground"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <DrawerHeader className="flex flex-row items-center justify-between gap-3 pb-2 text-left">
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerClose asChild>
            <button
              type="button"
              aria-label="Close selection"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </DrawerClose>
          <DrawerDescription className="sr-only">
            Choose one item from the options below.
          </DrawerDescription>
        </DrawerHeader>
        <div
          className="stockhaven-scroll-list max-h-[65dvh] overflow-y-auto overscroll-contain px-3 pb-4"
          data-pull-refresh-ignore
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                disabled={option.disabled}
                aria-current={isSelected ? 'true' : undefined}
                onClick={() => {
                  onValueChange?.(option.value);
                  setOpen(false);
                }}
                className={cn(
                  'flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40',
                  isSelected ? 'bg-secondary font-semibold text-secondary-foreground' : 'text-foreground hover:bg-muted'
                )}
              >
                <span className="min-w-0 break-words">{option.label}</span>
                {isSelected && <Check className="h-5 w-5 shrink-0" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
