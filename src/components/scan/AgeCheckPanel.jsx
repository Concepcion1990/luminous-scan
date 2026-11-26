import { useState } from 'react';
import { ArrowLeft, CheckCircle2, RotateCcw, XCircle } from 'lucide-react';
import BarcodeScanner from '@/components/scan/BarcodeScanner';
import { createAgeCheckReader } from '@/lib/codeReader';
import { AGE_CATEGORIES, ageLinesFromBusiness, ageVerdict, todayParts } from '@/lib/ageCheck';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

const CATEGORY_KEYS = {
  alcohol: 'ageCheck.category.alcohol',
  tobacco: 'ageCheck.category.tobacco',
  other: 'ageCheck.category.other',
};

/**
 * The verdict display — the whole point of the feature (the
 * owner's words, Nov 25, 2026): a little GREEN check, "you're
 * good to go — they passed the test", or a little RED check,
 * the flag that says the sale must not happen. It receives
 * only the verdict — a status and the line it was judged
 * against — never anything read off the ID.
 */
export function AgeCheckVerdict({ verdict, category }) {
  if (!verdict) return null;
  const passed = verdict.status === 'pass';
  const Icon = passed ? CheckCircle2 : XCircle;
  const textKey =
    verdict.status === 'pass'
      ? 'ageCheck.pass'
      : verdict.status === 'fail'
        ? 'ageCheck.fail'
        : verdict.status === 'expired'
          ? 'ageCheck.expired'
          : 'ageCheck.unreadable';
  return (
    <div
      className={`flex flex-col items-center gap-2 rounded-xl border p-5 text-center ${
        passed ? 'border-ok/40 bg-ok/10' : 'border-destructive/40 bg-destructive/10'
      }`}
      role="status"
    >
      <Icon className={`h-14 w-14 ${passed ? 'text-ok' : 'text-destructive'}`} />
      <p className="text-base font-semibold">{t(textKey)}</p>
      <p className="text-xs text-muted-foreground">
        {t('ageCheck.lineNote', { category: t(CATEGORY_KEYS[category]), age: verdict.line })}
      </p>
    </div>
  );
}

/**
 * Age check (the owner's spec, Nov 25, 2026): scan the PDF417
 * barcode on the back of a driver's license / state ID and get
 * the green or red check against the owner's age lines.
 *
 * THE APP KEEPS NOTHING WHATSOEVER. The scanned payload is a
 * local argument to ageVerdict — it is never put in state,
 * never stored, never sent anywhere, never logged. The only
 * state this panel holds is the picked category and the
 * verdict itself ({status, line}), and both are gone when the
 * panel closes. There is deliberately no history, no list and
 * no record of checks — see src/lib/ageCheck.js.
 */
export default function AgeCheckPanel({ business, onClose }) {
  const lines = ageLinesFromBusiness(business);
  const [category, setCategory] = useState('alcohol');
  const [verdict, setVerdict] = useState(null);
  const [session, setSession] = useState(0);

  const handleDetect = (text) => {
    // The payload lives only inside this call. The verdict —
    // status + line — is all that is kept, and only on screen.
    setVerdict(ageVerdict(text, category, lines, todayParts()));
  };

  const checkAnother = () => {
    setVerdict(null);
    setSession((s) => s + 1);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{t('ageCheck.title')}</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> {t('ageCheck.back')}
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">{t('ageCheck.intro')}</p>

      <div className="space-y-1.5">
        <Label className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {t('ageCheck.categoryLabel')}
        </Label>
        <div className="grid grid-cols-3 gap-1.5">
          {AGE_CATEGORIES.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setCategory(key);
                setVerdict(null);
              }}
              className={`rounded-md border px-2 py-2 text-xs font-medium transition-colors ${
                category === key
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border hover:bg-muted'
              }`}
            >
              {t(CATEGORY_KEYS[key])}
              <span className={`block text-[11px] ${category === key ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
                {lines[key]}+
              </span>
            </button>
          ))}
        </div>
      </div>

      {!verdict ? (
        <div data-pull-refresh-ignore>
          <BarcodeScanner key={session} onDetect={handleDetect} createReader={createAgeCheckReader} footerText="PDF417" />
          <p className="mt-2 text-center text-xs text-muted-foreground">{t('ageCheck.scanPrompt')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          <AgeCheckVerdict verdict={verdict} category={category} />
          <Button className="w-full" variant="outline" onClick={checkAnother}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> {t('ageCheck.checkAnother')}
          </Button>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">{t('ageCheck.keepsNothing')}</p>
    </div>
  );
}
