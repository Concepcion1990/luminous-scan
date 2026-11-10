import { useEffect, useRef, useState } from 'react';

// A handheld scanner is just a keyboard: it types a whole code in a few
// milliseconds and ends with Enter. Anything slower is someone typing.
const MACHINE_GAP_MS = 110;
const FLUSH_GAP_MS = 400;
const MIN_LENGTH = 4;

/**
 * Listens for handheld (keyboard-wedge) scanner input anywhere on the page, so
 * a reader works without clicking into a field first. Text typed into form
 * fields is left alone.
 */
export default function useScannerInput({ onScan, enabled = true }) {
  const [armed, setArmed] = useState(false);
  const [lastCode, setLastCode] = useState('');
  const buffer = useRef('');
  const typedAt = useRef(0);
  const scanRef = useRef(onScan);
  scanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return undefined;

    const clear = () => {
      buffer.current = '';
      typedAt.current = 0;
      setArmed(false);
    };

    const isEditable = (node) =>
      node instanceof HTMLElement &&
      (node.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName));

    const handleKey = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditable(event.target)) return;

      if (event.key === 'Enter') {
        const code = buffer.current;
        const fresh = Date.now() - typedAt.current <= FLUSH_GAP_MS;
        clear();
        if (!fresh || code.length < MIN_LENGTH) return;
        event.preventDefault();
        setLastCode(code);
        scanRef.current?.(code);
        return;
      }

      if (event.key.length !== 1) return;
      const now = Date.now();
      buffer.current =
        now - typedAt.current > MACHINE_GAP_MS ? event.key : buffer.current + event.key;
      typedAt.current = now;
      setArmed(buffer.current.length >= MIN_LENGTH);
    };

    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
  }, [enabled]);

  return { armed, lastCode };
}