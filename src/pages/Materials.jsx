import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/client';
import { Boxes, Check, Plus } from 'lucide-react';
import AssembleDialog from '@/components/materials/AssembleDialog';
import BomCard from '@/components/materials/BomCard';
import BomDialog from '@/components/materials/BomDialog';
import DisassembleDialog from '@/components/materials/DisassembleDialog';
import PlanGate from '@/components/plan/PlanGate';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useBusiness } from '@/hooks/useBusiness';
import useEntitlements from '@/hooks/useEntitlements';
import { scoped } from '@/lib/scoped';
import {
  availabilityAt,
  bundleOnHand,
  componentRows,
  listBoms,
  listBuildableProducts,
} from '@/lib/bom';

const FILTERS = [
  { key: 'all', label: 'Everything' },
  { key: 'bundle', label: 'Bundles & kits' },
  { key: 'recipe', label: 'Recipes & materials' },
];

export default function Materials() {
  const { user, activeId } = useBusiness();
  // In-page mirror of the route-level PlanGate (App.jsx): the page is safe
  // on its own if it is ever rendered without the route gate. While the
  // entitlement is still loading the plan is unknown, so nothing is locked
  // yet — the same fail-open-while-loading shape PlanGate itself uses.
  const { can, isLoading: entitlementLoading } = useEntitlements();
  const [boms, setBoms] = useState([]);
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [levels, setLevels] = useState([]);
  const [locationId, setLocationId] = useState('');
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(null);
  const [bomDialogOpen, setBomDialogOpen] = useState(false);
  const [assembling, setAssembling] = useState(null);
  const [takingApart, setTakingApart] = useState(null);
  const [flash, setFlash] = useState(null);

  useEffect(() => {
    (async () => {
      const [bomList, productList, locPage, levelPage] = await Promise.all([
        listBoms(activeId || ''),
        listBuildableProducts(activeId || ''),
        base44.entities.Location.filter(scoped({}, activeId), { sort: 'name', limit: 100 }),
        base44.entities.StockLevel.filter(scoped({}, activeId), { limit: 2000 }),
      ]);
      setBoms(bomList);
      setProducts(productList);
      setLocations(locPage.items ?? []);
      setLevels(levelPage.items ?? []);
      setLoading(false);
    })();
  }, [activeId, reload]);

  useEffect(() => {
    if (locations.length && !locations.find((l) => l.id === locationId)) {
      setLocationId(locations[0].id);
    }
  }, [locations, locationId]);

  const shown = useMemo(
    () => (filter === 'all' ? boms : boms.filter((bom) => bom.kind === filter)),
    [boms, filter]
  );

  const remove = async (bom) => {
    if (!window.confirm(`Delete the build list for ${bom.product_name}? Stock is not touched.`)) return;
    await base44.entities.Bom.delete(bom.id);
    setFlash({ ok: true, text: `${bom.product_name}: build list deleted.` });
    setReload((n) => n + 1);
  };

  const locationName = locations.find((l) => l.id === locationId)?.name;

  if (!entitlementLoading && !can('builds')) return <PlanGate feature="builds" />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Materials · BOM
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">Bundles &amp; builds</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pack kits from stock, or use up materials to make a finished item.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setBomDialogOpen(true);
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" /> New build list
        </Button>
      </div>

      {flash && (
        <p className="flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> {flash.text}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Build at
          </span>
          <Select value={locationId || 'none'} onValueChange={(v) => setLocationId(v === 'none' ? '' : v)}>
            <SelectTrigger className="w-[200px] bg-card">
              <SelectValue placeholder="Choose location" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Choose location</SelectItem>
              {locations.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                filter === f.key
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading build lists…</p>}

      {!loading && !shown.length && (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <Boxes className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">No build lists yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Create one for a kit you pack from existing products, or for an item you make from materials.
          </p>
        </div>
      )}

      {!loading && shown.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((bom) => (
            <BomCard
              key={bom.id}
              bom={bom}
              available={availabilityAt(bom, levels, locationId)}
              parts={componentRows(bom, levels, locationId, 1)}
              onHand={bundleOnHand(bom, levels, locationId)}
              onAssemble={() => setAssembling(bom)}
              onDisassemble={() => setTakingApart(bom)}
              onEdit={() => {
                setEditing(bom);
                setBomDialogOpen(true);
              }}
              onDelete={() => remove(bom)}
            />
          ))}
        </div>
      )}

      {!loading && shown.length > 0 && (
        <p className="text-xs text-muted-foreground">
          On-hand and buildable counts are for {locationName || 'the chosen location'} right now.
        </p>
      )}

      <BomDialog
        open={bomDialogOpen}
        onOpenChange={setBomDialogOpen}
        bom={editing}
        products={products}
        boms={boms}
        onSaved={(text) => {
          setFlash({ ok: true, text });
          setReload((n) => n + 1);
        }}
      />

      <AssembleDialog
        open={Boolean(assembling)}
        onOpenChange={(next) => !next && setAssembling(null)}
        bom={assembling}
        locations={locations}
        levels={levels}
        user={user}
        onDone={(text) => {
          setFlash({ ok: true, text });
          setReload((n) => n + 1);
        }}
      />

      <DisassembleDialog
        open={Boolean(takingApart)}
        onOpenChange={(next) => !next && setTakingApart(null)}
        bom={takingApart}
        locations={locations}
        levels={levels}
        user={user}
        onDone={(text) => {
          setFlash({ ok: true, text });
          setReload((n) => n + 1);
        }}
      />
    </div>
  );
}