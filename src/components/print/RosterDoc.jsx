import { t } from '@/lib/i18n';
import { roleById, statusMeta } from '@/lib/staff';
import { docRootClass, docRootStyle } from '@/lib/docStyle';
import { DecoFooter, DecoHeader, DocFrame, PrintedAt } from './DocChrome';
import DocHeader from './DocHeader';

/**
 * The staff roster (the prints build, Nov 25, 2026): the whole
 * team on one Studio sheet — name, role, location, email and
 * status — printed from the Staff page by anyone who can
 * already see the team list there.
 */

const TH = 'border-b border-black pb-1 text-left font-mono text-[6.5pt] uppercase tracking-wide';
const TD = 'py-1 align-top text-[9pt]';

export default function RosterDoc({ members = [], roles = [], business, docStyle }) {
  return (
    <div
      className={`print-label print-page-break doc-root w-[180mm] bg-white p-2 text-black ${docRootClass(docStyle)}`}
      style={docRootStyle(docStyle, business?.brand_color)}
    >
      <DocFrame style={docStyle} brandColor={business?.brand_color} />
        <DecoHeader style={docStyle} className="mb-2" />
        <DocHeader business={business} title={t('print.staffRosterTitle')} style={docStyle} />
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={`${TH} w-[24%]`}>{t('staff.memberDialog.nameLabel')}</th>
              <th className={TH}>{t('staff.memberDialog.roleLabel')}</th>
              <th className={TH}>{t('print.fieldLocation')}</th>
              <th className={TH}>{t('staff.memberDialog.emailLabel')}</th>
              <th className={TH}>{t('ops.invoices.colStatus')}</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id} className="border-b border-black/15">
                <td className={`${TD} font-semibold`}>{member.full_name}</td>
                <td className={TD}>{roleById(member.role_id, roles)?.name || '—'}</td>
                <td className={TD}>{member.location_name || '—'}</td>
                <td className={TD}>{member.email || '—'}</td>
                <td className={TD}>{statusMeta(member.status).label}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <DecoFooter style={docStyle} />
        <PrintedAt />
    </div>
  );
}
