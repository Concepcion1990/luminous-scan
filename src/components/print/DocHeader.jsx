const today = () =>
  new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

function BlankField({ label, width = 'w-[26mm]' }) {
  return (
    <p className="flex items-baseline gap-1 text-[8pt]">
      <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">{label}</span>
      <span className={`inline-block border-b border-dotted border-black/60 ${width}`}>&nbsp;</span>
    </p>
  );
}

export default function DocHeader({ business, title, subtitle, fields = [] }) {
  return (
    <header className="border-b border-black pb-2">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[6.5pt] uppercase tracking-[0.18em]">{business?.name}</p>
          <p className="text-[13pt] font-semibold leading-tight">{title}</p>
          {subtitle && <p className="text-[7.5pt] text-black/70">{subtitle}</p>}
        </div>
        <p className="font-mono text-[7pt]">{today()}</p>
      </div>
      {fields.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
          {fields.map(([label, width]) => (
            <BlankField key={label} label={label} width={width} />
          ))}
        </div>
      )}
    </header>
  );
}