import { Archive, ArchiveRestore, CopyPlus, MoreHorizontal, PackagePlus, Trash2 } from 'lucide-react';
import { t } from '@/lib/i18n';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** Secondary catalog actions for one product: add stock, duplicate, archive or restore, delete. */
export default function ProductRowMenu({ product, onDuplicate, onToggleArchive, onAddStock, onDelete }) {
  const archived = product.status === 'archived';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-11 w-11 lg:h-8 lg:w-8" aria-label={t('products.moreActionsAria')}>
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {onAddStock && (
          <DropdownMenuItem onSelect={() => onAddStock(product)}>
            <PackagePlus className="mr-2 h-3.5 w-3.5" /> {t('products.addStock')}
          </DropdownMenuItem>
        )}
        {onDuplicate && (
          <DropdownMenuItem onSelect={() => onDuplicate(product)}>
            <CopyPlus className="mr-2 h-3.5 w-3.5" /> {t('products.duplicate')}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => onToggleArchive(product)}>
          {archived ? (
            <>
              <ArchiveRestore className="mr-2 h-3.5 w-3.5" /> {t('products.restore')}
            </>
          ) : (
            <>
              <Archive className="mr-2 h-3.5 w-3.5" /> {t('products.archive')}
            </>
          )}
        </DropdownMenuItem>
        {onDelete && (
          <DropdownMenuItem
            onSelect={() => onDelete(product)}
            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" /> {t('products.delete')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}