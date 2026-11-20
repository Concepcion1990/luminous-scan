import { useRef, useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import useDismissOnOutside from '@/hooks/useDismissOnOutside';
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
 *
 * The list opens on INTENT only — a pointer tap into the field,
 * the chevron, or typing — never on focus alone (Nov 20, 2026,
 * owner catch): this picker lives inside Radix dialogs, whose
 * focus machinery lands focus in the first field when the dialog
 * opens and hands focus back after outside taps. When focus
 * itself opened the list, Bulk edit appeared with the Category
 * list already sprung, every outside tap that closed it was
 * undone an instant later by the returning focus, and the list
 * could not be kept closed at all. A tap is a person asking for
 * the list; focus arriving on its own is the dialog talking to
 * itself, so dismissal now always wins over a focus return.
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
  const rootRef = useRef(null);
  const typed = String(value || '').trim().toLowerCase();
  const filtered = options.filter((name) => !typed || name.toLowerCase().includes(typed));
  const showList = open && (filtered.length > 0 || Boolean(onAddNewRequest));

  // Outside-tap dismissal (Nov 15, 2026): blur alone does not
  // close the list when a tap lands on dead space — on a phone
  // the input keeps focus and the list hangs open. The shared
  // hook closes it on any pointer-down outside this root (and
  // on Escape); selection still happens on pointerdown inside,
  // before any of this can race it.
  useDismissOnOutside({ open, onDismiss: () => setOpen(false), rootRef });

  const pick = (name) => {
    onChange(name);
    setOpen(false);
  };

  return (
    <div
      ref={rootRef}
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
          onPointerDown={() => setOpen(true)}
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
                  // The Add window takes focus next; release this
                  // field first so nothing here is still holding
                  // focus when it opens (Nov 20, 2026).
                  inputRef.current?.blur();
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
