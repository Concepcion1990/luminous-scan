import { t } from '@/lib/i18n';
import { docRootClass, docRootStyle } from '@/lib/docStyle';
import { DecoFooter, DecoHeader, DocFrame, PrintedAt } from './DocChrome';
import DocHeader from './DocHeader';

/**
 * Business Policies & Terms on paper (the prints build,
 * Nov 25, 2026): the owner's own store policies and terms &
 * conditions, printed exactly as written — the words are the
 * owner's, never translated or reformatted by the paper. A
 * document kept as an uploaded file prints its heading and
 * the file's name, so the paper set stays complete. The door
 * lives in the Settings policies card, for everyone who can
 * already read the card.
 */

function PolicySection({ heading, doc }) {
  if (!doc || doc.kind === 'empty') return null;
  return (
    <div className="mb-5">
      <h3 className="mb-1 font-display text-[13pt] font-semibold">{heading}</h3>
      {doc.kind === 'text' ? (
        <p className="whitespace-pre-line text-[9.5pt] leading-relaxed">{doc.text}</p>
      ) : (
        <p className="text-[9.5pt]">{t('print.policiesFileNote', { filename: doc.filename || '' })}</p>
      )}
    </div>
  );
}

export default function PoliciesDoc({ docs, business, docStyle }) {
  return (
    <div
      className={`print-label print-page-break doc-root w-[180mm] bg-white p-2 text-black ${docRootClass(docStyle)}`}
      style={docRootStyle(docStyle, business?.brand_color)}
    >
      <DocFrame style={docStyle} brandColor={business?.brand_color} />
        <DecoHeader style={docStyle} className="mb-2" />
        <DocHeader business={business} title={t('settings.policies.title')} style={docStyle} />
        <PolicySection heading={t('settings.policies.storePolicies')} doc={docs?.policies} />
        <PolicySection heading={t('settings.policies.termsConditions')} doc={docs?.terms} />
        <DecoFooter style={docStyle} />
        <PrintedAt />
    </div>
  );
}
