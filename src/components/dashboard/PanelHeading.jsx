/** The one heading style every overview panel uses, with an optional shortcut. */
export default function PanelHeading({ children, sub, action }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{children}</h2>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </div>
      {action}
    </div>
  );
}