import { X } from 'lucide-react';
import { t } from '@/lib/i18n';

import { orderedLocations } from '@/lib/locations';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ALL = 'all';

export const EMPTY_FILTERS = {
  category: '',
  tag: '',
  status: '',
  condition: '',
  locationId: '',
};

function FilterSelect({ label, value, options, onChange, className = '' }) {
  return (
    <div className={`min-w-0 sm:w-[168px] ${className}`}>
      <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? '' : v)}>
        <SelectTrigger className="h-10 bg-card" aria-label={label}>
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{label}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export default function ProductFilterBar({
  categories = [],
  tags = [],
  locations = [],
  value,
  onChange,
}) {
  const STATUS_OPTIONS = [
    { value: 'active', label: t('products.statusActive') },
    { value: 'draft', label: t('products.statusDraft') },
    { value: 'archived', label: t('products.statusArchived') },
    { value: 'discontinued', label: t('products.statusDiscontinued') },
  ];

  const CONDITION_OPTIONS = [
    { value: 'New', label: t('products.conditionNew') },
    { value: 'Like new', label: t('products.conditionLikeNew') },
    { value: 'Very good', label: t('products.conditionVeryGood') },
    { value: 'Good', label: t('products.conditionGood') },
    { value: 'Acceptable', label: t('products.conditionAcceptable') },
  ];

  const set = (key) => (next) => onChange({ ...value, [key]: next });
  const isFiltered = Boolean(
    value.category || value.tag || value.status || value.condition || value.locationId
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:flex sm:flex-none">
        <FilterSelect
          label={t('products.filterAllCategories')}
          value={value.category}
          onChange={set('category')}
          options={categories.map((name) => ({ value: name, label: name }))}
        />
        <FilterSelect
          label={t('products.filterAllTags')}
          value={value.tag}
          onChange={set('tag')}
          options={tags.map((name) => ({ value: name, label: name }))}
        />
        <FilterSelect
          label={t('products.filterAllStatuses')}
          value={value.status}
          onChange={set('status')}
          options={STATUS_OPTIONS}
        />
        <FilterSelect
          label={t('products.filterAllConditions')}
          value={value.condition}
          onChange={set('condition')}
          options={CONDITION_OPTIONS}
        />
        <FilterSelect
          label={t('products.filterAllLocations')}
          value={value.locationId}
          onChange={set('locationId')}
          options={orderedLocations(locations).map(({ location, depth }) => ({
            value: location.id,
            label: `${'— '.repeat(depth)}${location.name}`,
          }))}
          className="col-span-2 sm:col-span-1"
        />
      </div>
      {isFiltered && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => onChange(EMPTY_FILTERS)}
        >
          <X className="mr-1 h-3.5 w-3.5" /> {t('products.clearFilters')}
        </Button>
      )}
    </div>
  );
}