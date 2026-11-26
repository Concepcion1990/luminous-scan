import { t } from '@/lib/i18n';
import { formatBusinessDate } from '@/lib/dates';
import { docRootClass, docRootStyle } from '@/lib/docStyle';
import { DecoFooter, DecoHeader, DocFrame, PrintedAt } from './DocChrome';
import DocHeader from './DocHeader';

/**
 * The training record (the prints build, Nov 25, 2026): the
 * whole team's filed training on Studio paper — who finished
 * what, with quiz scores, pass marks and dates, plus the
 * owner's own policy/terms filings. It prints from the
 * Training page's team section, which owners and managers
 * already see; the paper carries nothing beyond that view.
 */

const TH = 'border-b border-black pb-1 text-left font-mono text-[6.5pt] uppercase tracking-wide';
const TD = 'py-1 align-top text-[9pt]';

export default function TrainingRecordDoc({ people = [], business, docStyle }) {
  return (
    <div
      className={`print-label print-page-break doc-root w-[180mm] bg-white p-2 text-black ${docRootClass(docStyle)}`}
      style={docRootStyle(docStyle, business?.brand_color)}
    >
      <DocFrame style={docStyle} brandColor={business?.brand_color} />
        <DecoHeader style={docStyle} className="mb-2" />
        <DocHeader business={business} title={t('training.team.record')} style={docStyle} />
        {people.map((person) => (
          <div key={person.name} className="mb-4">
            <p className="text-[10.5pt] font-semibold">
              {person.name}
              {person.role ? <span className="ml-2 text-[8.5pt] font-normal">{person.role}</span> : null}
            </p>
            <p className="mb-1 text-[9pt]">{t('training.lessonsDoneOf', { done: person.done, total: person.total })}</p>
            {person.results?.length ? (
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={`${TH} w-[46%]`}>{t('print.colLesson')}</th>
                    <th className={TH}>{t('print.colScore')}</th>
                    <th className={TH}>{t('print.transferDate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {person.results.map((result, index) => (
                    <tr key={`${result.lesson}-${index}`} className="border-b border-black/15">
                      <td className={TD}>{result.lesson}</td>
                      <td className={TD}>
                        {t('training.team.scoreOf', { correct: result.correct, total: result.total })}
                        {' — '}
                        {result.passed ? t('training.team.passed') : t('training.team.notPassed')}
                      </td>
                      <td className={TD}>{result.date ? formatBusinessDate(result.date, business) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {person.policies?.map((attempt, index) => (
              <p key={`policy-${index}`} className="mt-1 text-[9pt]">
                {t('training.team.recordPolicy')}: {attempt.docLabel} — {attempt.statusLabel}
                {attempt.score != null ? ` · ${t('training.policy.score', { score: attempt.score })}` : ''}
                {attempt.date ? ` · ${formatBusinessDate(attempt.date, business)}` : ''}
              </p>
            ))}
            {person.warnings?.map((warning, index) => (
              <p key={`warning-${index}`} className="mt-1 text-[9pt]">
                {t('training.warningSentOn', { date: formatBusinessDate(warning, business) })}
              </p>
            ))}
          </div>
        ))}
        <DecoFooter style={docStyle} />
        <PrintedAt />
    </div>
  );
}
