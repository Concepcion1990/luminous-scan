import { useEffect } from 'react';

/**
 * One dismissal behavior for the app's hand-rolled menus and
 * popovers (owner's phone, Nov 15, 2026): while the surface is
 * open, a pointer-down anywhere OUTSIDE it closes it, and
 * Escape closes it too. "Outside" is measured against the
 * surface's own roots — the panel itself plus, where the
 * toggle lives elsewhere, the toggle (extraRefs) — never
 * against a wider container: the All screens menu's panel sits
 * inside the app header, and a tap on the header's own chrome
 * is still a tap outside the MENU. Nothing about what the
 * surface contains or how it opens changes. Radix surfaces
 * (Select, DropdownMenu, Popover, Dialog, Drawer) ship their
 * own dismissal and do not use this.
 */
export default function useDismissOnOutside({ open, onDismiss, rootRef, extraRefs = [] }) {
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!(event.target instanceof Node)) return;
      const roots = [rootRef, ...extraRefs];
      const inside = roots.some((ref) => ref?.current && ref.current.contains(event.target));
      if (!inside) onDismiss();
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onDismiss();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
    // The dismiss closures handed in are behaviorally stable
    // (set-state calls), so the listeners bind on open/close.
  }, [open, rootRef]);
}
