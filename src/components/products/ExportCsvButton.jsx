import { useState } from 'react';
import { ChevronDown, Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/use-toast';
import useEntitlements from '@/hooks/useEntitlements';
import { loadInventory } from '@/lib/inventory';
import { downloadCsv, fileSlug, fileStamp, toCsv } from '@/lib/csv';
import { t } from '@/lib/i18n';


export default function ExportCsvButton({ businessName, businessId }) {
  const { toast } = useToast();
  const { isEssentials, isLoading: entitlementLoading } = useEntitlements();
  const [busy, setBusy] = useState(false);

  const run = async (format) => {
    if (busy) return;
    setBusy(true);
    try {
      const { products, levels, locations } = await loadInventory(businessId || '');

      const totals = new Map();
      const perLocation = new Map();
      levels.forEach((level) => {
        totals.set(level.product_id, (totals.get(level.product_id) || 0) + (level.quantity || 0));
        const byLocation = perLocation.get(level.product_id) || new Map();
        byLocation.set(level.location_id, (byLocation.get(level.location_id) || 0) + (level.quantity || 0));
        perLocation.set(level.product_id, byLocation);
      });

      const columns = [
        { label: t('products.exportColName'), value: (p) => p.name },
        { label: t('products.exportColSku'), value: (p) => p.sku, text: true },
        { label: t('products.exportColCategory'), value: (p) => p.category || '' },
        { label: t('products.exportColUnit'), value: (p) => p.unit || t('products.unitEach') },
        { label: t('products.exportColUpc'), value: (p) => p.upc || '', text: true },
        { label: t('products.exportColBarcode'), value: (p) => p.barcode || '', text: true },
        { label: t('products.exportColQr'), value: (p) => p.qr_code || '', text: true },
        { label: t('products.exportColCost'), value: (p) => p.cost ?? '' },
        { label: t('products.exportColPrice'), value: (p) => p.price ?? '' },
        { label: t('products.exportColReorder'), value: (p) => p.reorder_point ?? 0 },
        { label: t('products.exportColOnHand'), value: (p) => totals.get(p.id) || 0 },
        ...locations.map((location) => ({
          label: t('products.exportColOnHandLocation', { location: location.name }),
          value: (p) => perLocation.get(p.id)?.get(location.id) || 0,
        })),
        { label: t('products.exportColNotes'), value: (p) => p.notes || '' },
        { label: t('products.exportColActive'), value: (p) => (p.active === false ? t('products.exportNo') : t('products.exportYes')) },
        { label: t('products.exportColCreated'), value: (p) => p.created_date || '' },
      ];

      const base = `${fileSlug(businessName) || 'inventory'}-catalog-${fileStamp()}`;
      if (format === 'xlsx') {
        const { downloadSheets } = await import('@/lib/xlsx');
        downloadSheets([{ name: t('products.exportSheetName'), columns, rows: products }], `${base}.xlsx`);
      } else {
        downloadCsv(`${base}.csv`, toCsv(columns, products));
      }

      toast({
        title: t('products.exportedTitle'),
        description: t('products.exportedDescription', {
          count: products.length,
          plural: products.length === 1 ? '' : 's',
          format: format === 'xlsx' ? 'Excel' : 'CSV',
        }),
      });
    } catch {
      toast({
        title: t('products.exportFailedTitle'),
        description: t('products.exportFailedDescription'),
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  // Export is Business-only, but this button sits on the Products page,
  // which Essentials uses — so the button itself refuses to render there (or
  // while the plan is still loading). The /exports page is PlanGate-locked
  // too, and the Alerts/Reports/Valuation exports live on Business-only
  // pages. Essentials keeps Import, which is a separate page that the same
  // permission key also opens. Export is client-side (the file is built in
  // the browser), so there is no server endpoint to refuse it at — hiding
  // the only Essentials export button is the enforcement.
  if (entitlementLoading || isEssentials) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={busy}>
          {busy ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-1.5 h-4 w-4" />
          )}
          {busy ? t('products.exporting') : t('products.exportButton')}
          <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => run('xlsx')}>
          <FileSpreadsheet className="mr-2 h-3.5 w-3.5" /> {t('products.exportXlsx')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => run('csv')}>
          <Download className="mr-2 h-3.5 w-3.5" /> {t('products.exportCsv')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}