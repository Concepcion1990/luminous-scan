import { useRef, useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * A vocabulary picker that renders its own list (Nov 14, 2026).
 *
 * This replaces the native <datalist> combobox, which never opened
 * on the owner's Android Chrome: the data arrived fine (the datalist
 * held her categories) and taps focused the field, but the popup is
 * browser UI the app cannot render or control — and inside this
 * modal it simply never appeared. Every control that works on her
 * phone is app-rendered, so the list is app-rendered too:
 *
 *  - Tapping the field (or the chevron) opens the business's
 *    existing entries; typing filters them; tapping one fills the
 *    field. Free typing stays possible while deciding.
 *  - When onAddNewRequest is given, the list ends with an
 *    "Add new …" row — the ONLY door through which a new entry is
 *    born from this form (the save guard in ProductFormDialog
 *    refuses typed-but-unlisted values, so nothing is ever created
 *    silently by typing).
 *
 * Selection happens on pointerdown, before the input's blur, so a
 * tap can never lose the race against the list closing.
 */
export default function VocabularyCombobox({
  id,
  value,
  onChange,
  options = [],
  placeholder,
  label,
  addNewLabel,
  onAddNewRequest,
  inputClassName,
}) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  const typed = String(value || '').trim().toLowerCase();
  const filtered = options.filter((name) => !typed || name.toLowerCase().includes(typed));
  const showList = open && (filtered.length > 0 || Boolean(onAddNewRequest));

  const pick = (name) => {
    onChange(name);
    setOpen(false);
  };

  return (
    <div
      className="relative"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <div className="flex gap-2">
        <Input
          id={id}
          ref={inputRef}
          value={value}
          placeholder={placeholder}
          className={cn('min-w-0 flex-1', inputClassName)}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
          autoComplete="off"
        />
        <button
          type="button"
          aria-label={label}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-input bg-background text-muted-foreground"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => {
            setOpen((o) => !o);
            inputRef.current?.focus();
          }}
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
      {showList && (
        <ul
          data-vocab-list
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-48 overflow-auto rounded-md border border-border bg-popover p-1 shadow-md"
        >
          {filtered.map((name) => (
            <li key={name}>
              <button
                type="button"
                className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                onPointerDown={(e) => {
                  e.preventDefault();
                  pick(name);
                }}
              >
                {name}
              </button>
            </li>
          ))}
          {onAddNewRequest && (
            <li className={cn(filtered.length > 0 && 'mt-1 border-t border-border pt-1')}>
              <button
                type="button"
                className="flex w-full items-center rounded px-2 py-1.5 text-left text-sm font-medium text-primary hover:bg-accent"
                onPointerDown={(e) => {
                  e.preventDefault();
                  setOpen(false);
                  onAddNewRequest();
                }}
              >
                <Plus className="mr-1.5 h-4 w-4" /> {addNewLabel}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
