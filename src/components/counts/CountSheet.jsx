import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Save, ScanLine, Send, Undo2 } from 'lucide-react';
import CountLineRow from '@/components/counts/CountLineRow';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { findProductsByCode } from '@/lib/inventory';
import {
  applyCounts,
  countSummary,
  discrepancies,
  expectedAt,
  reopenCounts,
  saveCounts,
  submitCounts,
} from '@/lib/counts';

export default function CountSheet({ session, products, levels, user, onChanged }) {
  const [lines, setLines] = useState(session.lines || []);
  const [scan, setScan] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setLines(session.lines || []);
    setDirty(false);
    setError('');
  }, [session.id, session.status]);

  const summary = useMemo(() => countSummary(lines), [lines]);
  const locked = ['applied', 'cancelled'].includes(session.status);

  const setCount = (productId, value) => {
    setLines((prev) => prev.map((l) => (l.product_id === productId ? { ...l, counted: value } : l)));
    setDirty(true);
  };

  const addByScan = async () => {
    const code = scan.trim();
    if (!code) return;
    setError('');
    setBusy('scan');
    try {
      const matches = await findProductsByCode(code, session.business_id);
      if (!matches.length) throw new Error(`No product matches ${code}. Add it to the catalog first.`);
      const product = matches[0];
      setLines((prev) => {
        const existing = prev.find((l) => l.product_id === product.id);
        if (existing) {
          return prev.map((l) =>
            l.product_id === product.id
              ? { ...l, counted: (Number(l.counted) || 0) + 1 }
              : l
          );
        }
        return [
          ...prev,
          {
            product_id: product.id,
            product_name: product.name,
            sku: product.sku || '',
            expected: expectedAt(levels, session.location_id, product.id),
            counted: 1,
          },
        ];
      });
      setDirty(true);
      setScan('');
    } catch (e) {
      setError(e.message || 'That code could not be read.');
    } finally {
      setBusy('');
    }
  };

  const save = async (message) => {
    setBusy('save');
    setError('');
    try {
      await saveCounts(session.id, lines);
      setDirty(false);
      onChanged?.(message || `${session.number}: counts saved — stock unchanged.`);
    } catch (e) {
      setError(e.message || 'Could not save the counts.');
    } finally {
      setBusy('');
    }
  };

  const sendReview = async () => {
    setBusy('review');
    setError('');
    try {
      await submitCounts(session.id, lines);
      setDirty(false);
      onChanged?.(`${session.number}: sent for review — ${summary.differing} differences to approve.`);
    } catch (e) {
      setError(e.message || 'Could not send the session for review.');
    } finally {
      setBusy('');
    }
  };

  const apply = async () => {
    const differing = discrepancies(lines);
    if (
      differing.length &&
      !window.confirm(`Apply ${differing.length} differences? Stock will be set to the counted numbers.`)
    ) {
      return;
    }
    setBusy('apply');
    setError('');
    try {
      const applied = await applyCounts({ session, lines, products, user });
      setDirty(false);
      onChanged?.(
        applied
          ? `${session.number}: ${applied} product${applied === 1 ? '' : 's'} corrected.`
          : `${session.number}: closed — every counted line matched the system, so nothing changed.`
      );
    } catch (e) {
      setError(e.message || 'Could not apply the counts.');
    } finally {
      setBusy('');
    }
  };

  const reopen = async () => {
    setBusy('reopen');
    setError('');
    try {
      await reopenCounts(session.id, lines);
      onChanged?.(`${session.number}: reopened for more counting.`);
    } catch (e) {
      setError(e.message || 'Could not reopen the session.');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      {!locked && (
        <div className="flex gap-2">
          <Input
            value={scan}
            onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addByScan();
            }}
            placeholder="Scan or type a code to count it"
            className="font-mono text-xs"
            aria-label="Scan a product to count"
          />
          <Button variant="outline" onClick={addByScan} disabled={busy === 'scan'}>
            <ScanLine className="mr-1 h-4 w-4" /> Add
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          Counted <span className="numeric text-foreground">{summary.counted}</span> of {summary.total}
        </span>
        <span>
          Differences <span className="numeric text-foreground">{summary.differing}</span>
        </span>
        <span>
          Net units <span className="numeric text-foreground">{summary.net > 0 ? `+${summary.net}` : summary.net}</span>
        </span>
      </div>

      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing was on hand here when this session started — scan a product to add it.
        </p>
      ) : (
        <div className="max-h-[320px] overflow-y-auto pr-1">
          {lines.map((line) => (
            <CountLineRow
              key={line.product_id}
              line={line}
              onChange={locked ? () => {} : (value) => setCount(line.product_id, value)}
            />
          ))}
        </div>
      )}

      {session.status === 'review' && summary.differing > 0 && (
        <div className="rounded-lg border border-warn/30 bg-warn/8 p-2.5 text-xs">
          <p className="flex items-center gap-1.5 font-medium text-warn">
            <AlertTriangle className="h-3.5 w-3.5" /> Awaiting approval
          </p>
          <p className="mt-1 text-muted-foreground">
            Applying writes one count entry per differing product. Nothing has changed yet.
          </p>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!locked && (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={() => save()} disabled={busy === 'save' || !dirty}>
            <Save className="mr-1 h-3.5 w-3.5" /> Save counts
          </Button>
          {session.status === 'open' && (
            <Button size="sm" onClick={sendReview} disabled={busy === 'review'}>
              <Send className="mr-1 h-3.5 w-3.5" /> Send for review
            </Button>
          )}
          {session.status === 'review' && (
            <>
              <Button size="sm" onClick={apply} disabled={busy === 'apply'}>
                <Check className="mr-1 h-3.5 w-3.5" />{' '}
                {summary.differing ? 'Apply counts' : 'Close count'}
              </Button>
              <Button size="sm" variant="ghost" onClick={reopen} disabled={busy === 'reopen'}>
                <Undo2 className="mr-1 h-3.5 w-3.5" /> Keep counting
              </Button>
            </>
          )}
        </div>
      )}

      {session.status === 'applied' && (
        <p className="text-xs text-muted-foreground">
          Applied {session.applied_by ? `by ${session.applied_by}` : ''} — the sheet is kept as audit history.
        </p>
      )}

      <p className="text-[11px] text-muted-foreground">
        Counting never changes stock by itself; ordinary scans elsewhere are unaffected.
      </p>
      <Label className="sr-only">Count session {session.number}</Label>
    </div>
  );
}