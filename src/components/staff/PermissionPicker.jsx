import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import useEntitlements from '@/hooks/useEntitlements';
import { allPermissionsForPlan, permissionGroupsForPlan } from '@/lib/staff';

/**
 * Grouped permission checkboxes, with group and whole-list toggles. Only the
 * permissions the plan may offer are listed: on Essentials the Business-only
 * ones — bundles, purchasing, suppliers — are not offered at all, because
 * the modules they open are locked behind PlanGate there. While the plan is
 * still loading the offer stays restricted, never the full catalog.
 * Keys already granted another way are left alone on save; this only filters
 * what the form offers.
 */
export default function PermissionPicker({ value = [], onChange }) {
  const { isEssentials, isLoading: entitlementLoading } = useEntitlements();
  const offerBusinessOnly = !entitlementLoading && !isEssentials;
  const groups = permissionGroupsForPlan(offerBusinessOnly ? 'business' : 'essentials');
  const offerable = allPermissionsForPlan(offerBusinessOnly ? 'business' : 'essentials');
  const offerableSet = new Set(offerable);
  // Count only what this form can offer; keys granted another way are not
  // shown here and are preserved untouched when the form saves.
  const granted = new Set(value.filter((key) => offerableSet.has(key)));

  const toggle = (key, on) => {
    if (on) onChange([...new Set([...value, key])]);
    else onChange(value.filter((item) => item !== key));
  };

  const toggleGroup = (group, on) => {
    const keys = group.items.map((item) => item.key);
    if (on) onChange([...new Set([...value, ...keys])]);
    else onChange(value.filter((item) => !keys.includes(item)));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="numeric text-[11px] text-muted-foreground">
          {granted.size} of {offerable.length} permissions
        </p>
        <div className="flex gap-1">
          <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => onChange(offerable)}>
            All
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => onChange([])}>
            None
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {groups.map((group) => {
          const keys = group.items.map((item) => item.key);
          const onCount = keys.filter((key) => granted.has(key)).length;
          const allOn = onCount === keys.length;
          return (
            <div key={group.area} className="rounded-lg border border-border p-2.5">
              <button
                type="button"
                onClick={() => toggleGroup(group, !allOn)}
                className="flex w-full items-center justify-between gap-2 text-left"
              >
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {group.area}
                </span>
                <span className="numeric text-[10px] text-muted-foreground">
                  {onCount}/{keys.length}
                </span>
              </button>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {group.items.map((item) => (
                  <label key={item.key} className="flex items-start gap-2 text-xs leading-snug">
                    <Checkbox
                      checked={granted.has(item.key)}
                      onCheckedChange={(on) => toggle(item.key, Boolean(on))}
                      className="mt-0.5"
                    />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
