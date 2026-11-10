import { MapPin } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { orderedLocations } from '@/lib/locations';

/** Ticks any number of locations; an empty list means "every location". */
export default function LocationScopePicker({ locations, value = [], onChange }) {
  const places = orderedLocations(locations);
  const toggle = (id) =>
    onChange(value.includes(id) ? value.filter((current) => current !== id) : [...value, id]);

  return (
    <div className="space-y-1.5">
      <Label>Locations</Label>
      <div className="max-h-44 overflow-y-auto rounded-md border border-input p-1">
        <button
          type="button"
          onClick={() => onChange([])}
          className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm ${
            value.length === 0 ? 'bg-secondary font-medium' : 'hover:bg-secondary/60'
          }`}
        >
          <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
          All locations
        </button>
        {places.map(({ location, depth }) => (
          <label
            key={location.id}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-secondary/60"
          >
            <input
              type="checkbox"
              checked={value.includes(location.id)}
              onChange={() => toggle(location.id)}
              className="h-3.5 w-3.5 accent-primary"
            />
            <span className="truncate" style={{ paddingLeft: depth * 10 }}>
              {location.name}
            </span>
          </label>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Ticked locations are watched together. Leave everything unticked to watch all locations.
      </p>
    </div>
  );
}