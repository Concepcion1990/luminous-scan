import { Archive, ArchiveRestore, CopyPlus, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** Secondary catalog actions for one product: duplicate, archive or restore. */
export default function ProductRowMenu({ product, onDuplicate, onToggleArchive }) {
  const archived = product.status === 'archived';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-11 w-11 lg:h-8 lg:w-8" aria-label="More actions">
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={() => onDuplicate(product)}>
          <CopyPlus className="mr-2 h-3.5 w-3.5" /> Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onToggleArchive(product)}>
          {archived ? (
            <>
              <ArchiveRestore className="mr-2 h-3.5 w-3.5" /> Restore
            </>
          ) : (
            <>
              <Archive className="mr-2 h-3.5 w-3.5" /> Archive
            </>
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}