import { Copy, ExternalLink, Globe, PackageSearch, RotateCcw, ShieldAlert, Tag, Type } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { t } from '@/lib/i18n';

const TITLES = {
  url: 'scan.externalTitleUrl',
  structured: 'scan.externalTitleStructured',
  text: 'scan.externalTitleText',
};

/**
 * Shows everything a scan decoded that is not a single matched product.
 * Nothing opens, saves or changes stock until the user chooses an action.
 */
export default function ExternalCodePanel({ scanned, onDismiss, onSearch }) {
  const { toast } = useToast();
  const isUrl = scanned.kind === 'url';
  const isStructured = scanned.kind === 'structured';
  const unsafe = Boolean(scanned.unsafeLink);

  const copy = async (value) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: t('scan.copied') });
    } catch {
      toast({ title: t('scan.copyFailed'), description: value, variant: 'destructive' });
    }
  };

  const searchCode = isStructured ? scanned.identifier : scanned.raw;

  return (
    <div className="space-y-4 px-5 py-8 text-center">
      {isUrl ? (
        <Globe className="mx-auto h-6 w-6 text-ok" />
      ) : isStructured ? (
        <Tag className="mx-auto h-6 w-6 text-primary" />
      ) : unsafe ? (
        <ShieldAlert className="mx-auto h-6 w-6 text-warn" />
      ) : (
        <Type className="mx-auto h-6 w-6 text-muted-foreground" />
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium">
          {unsafe
            ? t('scan.externalUnsafeTitle')
            : t(TITLES[scanned.kind] || 'scan.externalTitleFallback')}
        </p>

        {isStructured ? (
          <dl className="mx-auto max-w-sm space-y-1 rounded-lg border border-border bg-muted/50 px-3 py-2 text-left">
            {scanned.fields.map((field) => (
              <div key={field.key} className="flex justify-between gap-3 text-xs">
                <dt className="font-mono uppercase tracking-wide text-muted-foreground">{field.key}</dt>
                <dd className="numeric truncate text-right text-foreground">{field.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mx-auto max-w-sm break-all rounded-lg border border-border bg-muted/60 px-3 py-2 font-mono text-xs">
            {isUrl ? scanned.url : scanned.raw}
          </p>
        )}

        <p className="mx-auto max-w-sm text-xs text-muted-foreground">
          {isUrl
            ? t('scan.externalUrlNote')
            : unsafe
              ? t('scan.externalUnsafeNote')
              : t('scan.externalNothingSaved')}
        </p>

        {isUrl && scanned.productRef && (
          <p className="mx-auto max-w-sm rounded-md bg-secondary px-3 py-2 text-left text-xs text-muted-foreground">
            {t('scan.externalProductRefStart')}{' '}
            <span className="numeric font-medium text-foreground">{scanned.productRef.value}</span>.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {isUrl && (
          <Button asChild>
            <a href={scanned.url} target="_blank" rel="noopener noreferrer nofollow">
              <ExternalLink className="h-4 w-4" />
              {t('scan.openWebsite')}
            </a>
          </Button>
        )}

        {isUrl && scanned.productRef && (
          <Button variant="outline" onClick={() => onSearch(scanned.productRef.value)}>
            <PackageSearch className="h-4 w-4" />
            {t('scan.findCodeInInventory')}
          </Button>
        )}

        {/* Text scans are not searchable: offering "Search inventory" here
            just re-ran the lookup and showed this same panel again. Copy
            and Scan next stay. */}
        {!isUrl && !unsafe && scanned.kind !== 'text' && searchCode && (
          <Button variant="outline" onClick={() => onSearch(searchCode)}>
            <PackageSearch className="h-4 w-4" />
            {t('scan.searchInventory')}
          </Button>
        )}

        <Button variant="outline" onClick={() => copy(isUrl ? scanned.url : searchCode || scanned.raw)}>
          <Copy className="h-4 w-4" />
          {t('scan.copy')}
        </Button>

        <Button variant="ghost" onClick={onDismiss}>
          <RotateCcw className="h-3.5 w-3.5" />
          {t('scan.scanNext')}
        </Button>
      </div>
    </div>
  );
}