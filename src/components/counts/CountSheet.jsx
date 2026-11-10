import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Save, ScanLine, Send, Undo2 } from 'lucide-react';
import { t } from '@/lib/i18n';

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
      if (!matches.length) throw new Error(t('counts.noProductMatch', { code }));
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
      setError(e.message || t('counts.codeReadFailed'));
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
      onChanged?.(message || t('counts.savedMessage', { number: session.number }));
    } catch (e) {
      setError(e.message || t('counts.saveFailed'));
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
      {!locked && (
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
          <Button variant="outline" onClick={addByScan} disabled={busy === 'scan'}>
            <ScanLine className="mr-1 h-4 w-4" /> {t('counts.addButton')}
          </Button>
        </div>
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
            <AlertTriangle className="h-3.5 w-3.5" /> {t('counts.awaitingApproval')}
          </p>
          <p className="mt-1 text-muted-foreground">
            {t('counts.awaitingHint')}
          </p>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!locked && (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={() => save()} disabled={busy === 'save' || !dirty}>
            <Save className="mr-1 h-3.5 w-3.5" /> {t('counts.saveCounts')}
          </Button>
          {session.status === 'open' && (
            <Button size="sm" onClick={sendReview} disabled={busy === 'review'}>
              <Send className="mr-1 h-3.5 w-3.5" /> {t('counts.sendForReview')}
            </Button>
          )}
          {session.status === 'review' && (
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