import { useEffect, useMemo, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { AlertTriangle, Check, Save, ScanLine, Send, Undo2 } from 'lucide-react';
import { t } from '@/lib/i18n';

import BarcodeScanner from '@/components/scan/BarcodeScanner';
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
  tallyCountedLine,
  wildCountLines,
} from '@/lib/counts';
import { locationPath } from '@/lib/locations';

export default function CountSheet({ session, products, levels, locations = [], user, canRun, onChanged }) {
  const [lines, setLines] = useState(session.lines || []);
  // The tally path resolves codes asynchronously while the camera
  // keeps firing, so scan handling reads and writes the lines
  // through this ref — every scan lands on the sheet the previous
  // scan left behind, never on a stale render's copy.
  const linesRef = useRef(session.lines || []);
  const [scan, setScan] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [tallyNote, setTallyNote] = useState(null);
  const scanQueueRef = useRef(Promise.resolve());
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);

  const commitLines = (next) => {
    linesRef.current = next;
    setLines(next);
  };

  useEffect(() => {
    commitLines(session.lines || []);
    setDirty(false);
    setError('');
    setTallyNote(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, session.status]);

  const summary = useMemo(() => countSummary(lines), [lines]);

  // Shelf order (release 378): when the sheet spans more
  // than one area of the walk, each area's lines sit under
  // its own subheader (the area's full path) so the counter
  // always knows which shelf they are standing at. A
  // single-area sheet renders exactly as it always has.
  const renderRows = useMemo(() => {
    const areaOf = (line) => line.location_id || session.location_id || '';
    const multiArea = new Set(lines.map(areaOf)).size > 1;
    const rows = [];
    let lastArea = null;
    for (const line of lines) {
      const area = areaOf(line);
      if (multiArea && area !== lastArea) {
        const loc = locations.find((l) => l.id === area);
        rows.push({
          header: true,
          key: `area-${area}`,
          label: loc ? locationPath(locations, loc) : line.location_name || session.location_name || '',
        });
      }
      lastArea = area;
      rows.push({ header: false, key: `${area}|${line.product_id}`, line });
    }
    return rows;
  }, [lines, locations, session.location_id, session.location_name]);

  // "That count looks wrong" (release 378): before a save or
  // a send for review, wildly-off lines are named and the
  // counter is ASKED — never blocked. A genuine find (a case
  // in the back nobody booked) saves exactly like any other
  // count once the counter confirms it.
  const confirmWild = () => {
    const wild = wildCountLines(linesRef.current);
    if (!wild.length) return true;
    return window.confirm(
      t('counts.wrongConfirm', {
        lines: wild
          .map((line) =>
            t('counts.wrongLine', { name: line.product_name, counted: line.counted, expected: line.expected })
          )
          .join('\n'),
      })
    );
  };
  const locked = ['applied', 'cancelled'].includes(session.status);
  // The floor split (owner ruling, Nov 19, 2026): a member
  // without counts.run works a count only while it is OPEN —
  // count, save, send for review. Once the count sits in
  // review it waits for a boss, so for everyone else the sheet
  // reads as locked, with the awaiting-approval note below
  // saying why. Applying and reopening render only for
  // counts.run holders; the server holds the same line.
  const floorLocked = locked || (!canRun && session.status !== 'open');

  // Shelf order (release 378): a product stocked in more
  // than one of the walk's areas has one line per area, so a
  // typed count lands on the line it was typed on — keyed by
  // product AND area, never by product alone.
  const setCount = (line, value) => {
    commitLines(
      linesRef.current.map((l) =>
        l.product_id === line.product_id && (l.location_id || '') === (line.location_id || '')
          ? { ...l, counted: value }
          : l
      )
    );
    setDirty(true);
  };

  // One scanned unit, shared by the typed code box and the camera
  // tally below: +1 on the product's line, or the product joins the
  // sheet at 1. Archived products stay frozen (owner doctrine): the
  // scan is refused with the restore-first guidance and no quantity
  // moves. An unknown code changes nothing.
  const applyScannedProduct = (product) => {
    if ((product.status || 'active') === 'archived') {
      throw new Error(t('inventoryLib.archivedFrozen', { name: product.name }));
    }
    const next = tallyCountedLine(
      linesRef.current,
      product,
      expectedAt(levels, session.location_id, product.id)
    );
    commitLines(next);
    setDirty(true);
    return next.find((l) => l.product_id === product.id);
  };

  const addByScan = async () => {
    const code = scan.trim();
    if (!code) return;
    setError('');
    setBusy('scan');
    try {
      const matches = await findProductsByCode(code, session.business_id);
      if (!matches.length) throw new Error(t('counts.noProductMatch', { code }));
      applyScannedProduct(matches[0]);
      setScan('');
    } catch (e) {
      setError(e.message || t('counts.codeReadFailed'));
    } finally {
      setBusy('');
    }
  };

  // The Add button's second job (owner ruling, Nov 14, 2026): with
  // the code box EMPTY, tapping it opens the scanner over the sheet —
  // the button carries the scan icon, so it should scan. What the
  // scanner DOES changed on Nov 16, 2026 (her scan-to-tally ruling):
  // it now stays open and tallies — every scan adds +1 to that
  // product's line and the count climbs on its own, so a whole
  // aisle can be scanned item by item with no typing. The scanner
  // knows it is scanning for THIS count only: a scan touches the
  // sheet and nothing else — stock moves later, through Save /
  // Send for review / Apply, exactly as before. With a code typed
  // in the box, Add keeps its original behavior above.
  const processTallyScan = async (code) => {
    try {
      const matches = await findProductsByCode(code, session.business_id);
      if (!matches.length) {
        setTallyNote({ ok: false, text: t('counts.noProductMatch', { code }) });
        return;
      }
      const line = applyScannedProduct(matches[0]);
      setTallyNote({
        ok: true,
        text: t('scanTally.scanned', { name: line.product_name, count: line.counted }),
      });
    } catch (e) {
      setTallyNote({ ok: false, text: e.message || t('counts.codeReadFailed') });
    }
  };

  const handleTallyDetect = (raw) => {
    const code = String(raw || '').trim();
    if (!code) return;
    // Serialize the captures: the camera re-arms itself while an
    // earlier code is still being looked up, and two scans racing
    // the same line must never lose a count.
    scanQueueRef.current = scanQueueRef.current
      .then(() => processTallyScan(code))
      .catch(() => {});
  };

  const onAddPressed = () => {
    if (scan.trim()) {
      addByScan();
    } else {
      setTallyNote(null);
      setScannerOpen(true);
    }
  };

  const save = async (message) => {
    if (!confirmWild()) return;
    setBusy('save');
    setError('');
    try {
      await saveCounts(session.id, lines);
      setDirty(false);
      onChanged?.(message || t('counts.savedMessage', { number: session.number }));
    } catch (e) {
      setError(e.message || t('counts.saveFailed'));
    } finally {
      setBusy('');
    }
  };

  const sendReview = async () => {
    if (!confirmWild()) return;
    setBusy('review');
    setError('');
    try {
      await submitCounts(session.id, lines);
      setDirty(false);
      onChanged?.(t('counts.sentForReview', { number: session.number, count: summary.differing }));
    } catch (e) {
      setError(e.message || t('counts.sendReviewFailed'));
    } finally {
      setBusy('');
    }
  };

  const apply = async () => {
    const differing = discrepancies(lines);
    if (
      differing.length &&
      !window.confirm(t('counts.applyConfirm', { count: differing.length }))
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
          ? t('counts.appliedCorrected', { number: session.number, count: applied, plural: applied === 1 ? '' : 's' })
          : t('counts.appliedClosed', { number: session.number })
      );
    } catch (e) {
      setError(e.message || t('counts.applyFailed'));
    } finally {
      setBusy('');
    }
  };

  const reopen = async () => {
    setBusy('reopen');
    setError('');
    try {
      await reopenCounts(session.id, lines);
      onChanged?.(t('counts.reopenedMessage', { number: session.number }));
    } catch (e) {
      setError(e.message || t('counts.reopenFailed'));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      {!floorLocked && (
        <div className="flex gap-2">
          <Input
            value={scan}
            onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addByScan();
            }}
            placeholder={t('counts.scanPlaceholder')}
            className="font-mono text-xs"
            aria-label={t('counts.scanAria')}
          />
          <Button variant="outline" onClick={onAddPressed} disabled={busy === 'scan'}>
            <ScanLine className="mr-1 h-4 w-4" /> {t('counts.addButton')}
          </Button>
        </div>
      )}

      {/* In-sheet tally scanner window: the sheet underneath never
          unmounts, so every counted value typed so far is
          preserved. The scanner stays open and tallies until Done
          — each capture lands on this sheet only (Nov 16, 2026).
          Since Nov 20, 2026 (release 328) it is a real Radix
          Dialog on the Add window's construction, not a hand-rolled
          fixed overlay: the hand-rolled card had no focus trap and
          no scroll lock, so focus stayed wherever it was and the
          page behind it still scrolled. As a real dialog the
          window holds focus and locks the page; Escape and the
          backdrop now also close it, exactly like Done — every
          tally already scanned stays on the sheet either way. */}
      {scannerOpen && (
        <DialogPrimitive.Root
          open
          onOpenChange={(next) => {
            if (!next) setScannerOpen(false);
          }}
        >
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
            <DialogPrimitive.Content
              aria-describedby={undefined}
              className="fixed left-[50%] top-[50%] z-[80] w-[calc(100vw-2rem)] max-w-sm translate-x-[-50%] translate-y-[-50%] space-y-3 rounded-xl bg-card p-4 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
            >
              <DialogPrimitive.Title className="flex items-center gap-1.5 text-sm font-medium">
                <ScanLine className="h-4 w-4" /> {t('scanTally.title')}
              </DialogPrimitive.Title>
              <BarcodeScanner onDetect={handleTallyDetect} />
              <p className="text-sm text-muted-foreground">{t('scanTally.hint')}</p>
              {tallyNote && (
                <p
                  className={`flex items-start gap-1.5 text-sm ${
                    tallyNote.ok ? 'text-ok' : 'text-destructive'
                  }`}
                  role="status"
                >
                  {tallyNote.ok && <Check className="mt-0.5 h-4 w-4 shrink-0" />}
                  <span>{tallyNote.text}</span>
                </p>
              )}
              <Button type="button" className="w-full" onClick={() => setScannerOpen(false)}>
                {t('scanTally.done')}
              </Button>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          {t('counts.summaryCounted')}{' '}
          <span className="numeric text-foreground">{summary.counted}</span>{' '}
          {t('counts.summaryCountedOf', { total: summary.total })}
        </span>
        <span>
          {t('counts.summaryDifferences')}{' '}
          <span className="numeric text-foreground">{summary.differing}</span>
        </span>
        <span>
          {t('counts.summaryNetUnits')}{' '}
          <span className="numeric text-foreground">{summary.net > 0 ? `+${summary.net}` : summary.net}</span>
        </span>
      </div>

      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('counts.emptySheet')}
        </p>
      ) : (
        // The row region pans BOTH ways (owner ruling, Nov 15,
        // 2026): on a narrow phone the rows run slightly wider
        // than the card and the first column's left edge clipped
        // with no way to reach it. The inner min-width lets the
        // rows overflow honestly so a sideways drag pans them
        // into reach. Vertical behavior is deliberately NOT
        // touched — no overscroll containment, no touch-action
        // restriction — so a vertical drag starting on the lines
        // scrolls exactly as it did before (the Nov 14 freeze
        // fix stands).
        <div className="max-h-[320px] overflow-auto pr-1">
          <div className="min-w-[21rem]">
            {renderRows.map((row) =>
              row.header ? (
                <p
                  key={row.key}
                  className="border-b border-border/60 bg-muted/40 px-1 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {row.label}
                </p>
              ) : (
                <CountLineRow
                  key={row.key}
                  line={row.line}
                  onChange={floorLocked ? () => {} : (value) => setCount(row.line, value)}
                />
              )
            )}
          </div>
        </div>
      )}

      {session.status === 'review' && summary.differing > 0 && (
        <div className="rounded-lg border border-warn/30 bg-warn/8 p-2.5 text-xs">
          <p className="flex items-center gap-1.5 font-medium text-warn">
            <AlertTriangle className="h-3.5 w-3.5" /> {t('counts.awaitingApproval')}
          </p>
          <p className="mt-1 text-muted-foreground">
            {t('counts.awaitingHint')}
          </p>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!floorLocked && (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={() => save()} disabled={busy === 'save' || !dirty}>
            <Save className="mr-1 h-3.5 w-3.5" /> {t('counts.saveCounts')}
          </Button>
          {session.status === 'open' && (
            <Button size="sm" onClick={sendReview} disabled={busy === 'review'}>
              <Send className="mr-1 h-3.5 w-3.5" /> {t('counts.sendForReview')}
            </Button>
          )}
          {session.status === 'review' && canRun && (
            <>
              <Button size="sm" onClick={apply} disabled={busy === 'apply'}>
                <Check className="mr-1 h-3.5 w-3.5" />{' '}
                {summary.differing ? t('counts.applyCounts') : t('counts.closeCount')}
              </Button>
              <Button size="sm" variant="ghost" onClick={reopen} disabled={busy === 'reopen'}>
                <Undo2 className="mr-1 h-3.5 w-3.5" /> {t('counts.keepCounting')}
              </Button>
            </>
          )}
        </div>
      )}

      {session.status === 'applied' && (
        <p className="text-xs text-muted-foreground">
          {session.applied_by
            ? t('counts.appliedByName', { name: session.applied_by })
            : t('counts.appliedNoName')}
        </p>
      )}

      <p className="text-[11px] text-muted-foreground">
        {t('counts.footerNote')}
      </p>
      <Label className="sr-only">{t('counts.sessionLabel', { number: session.number })}</Label>
    </div>
  );
}