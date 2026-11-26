import { t } from '@/lib/i18n';
import { docRootClass, docRootStyle } from '@/lib/docStyle';
import { DecoFooter, DecoHeader, DocFrame, PrintedAt } from './DocChrome';
import DocHeader from './DocHeader';

/**
 * The supplier directory (the prints build, Nov 25, 2026):
 * every supplier on one Studio sheet — contact, phone, email
 * and account number, address under the name. The Suppliers
 * page is Business-only, so the paper is too: the door lives
 * on that page and follows its gating exactly.
 */

const TH = 'border-b border-black pb-1 text-left font-mono text-[6.5pt] uppercase tracking-wide';
const TD = 'py-1 align-top text-[9pt]';

export default function SupplierDirectoryDoc({ suppliers = [], business, docStyle }) {
  return (
    <div
      className={`print-label print-page-break doc-root w-[180mm] bg-white p-2 text-black ${docRootClass(docStyle)}`}
      style={docRootStyle(docStyle, business?.brand_color)}
    >
      <DocFrame style={docStyle} brandColor={business?.brand_color} />
        <DecoHeader style={docStyle} className="mb-2" />
        <DocHeader business={business} title={t('print.supplierDirectoryTitle')} style={docStyle} />
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={`${TH} w-[26%]`}>{t('suppliers.supplierName')}</th>
              <th className={TH}>{t('suppliers.contact')}</th>
              <th className={TH}>{t('suppliers.phone')}</th>
              <th className={TH}>{t('suppliers.email')}</th>
              <th className={TH}>{t('suppliers.accountNumberLabel')}</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((supplier) => (
              <tr key={supplier.id} className="border-b border-black/15">
                <td className={TD}>
                  <span className="font-semibold">{supplier.name}</span>
                  {supplier.address ? <span className="block whitespace-pre-line text-[8pt]">{supplier.address}</span> : null}
                </td>
                <td className={TD}>{supplier.contact_name || '—'}</td>
                <td className={TD}>{supplier.phone || '—'}</td>
                <td className={TD}>{supplier.email || '—'}</td>
                <td className={TD}>{supplier.account_number || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <DecoFooter style={docStyle} />
        <PrintedAt />
    </div>
  );
}
