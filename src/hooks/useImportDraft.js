import { useEffect, useRef, useState } from 'react';
import { clearImportDraft, loadImportDraft, saveImportDraft } from '@/lib/importDraft';

/**
 * Keeps one workbench's staged import alive on the device.
 * `snapshot` is the staged state (null table = nothing staged);
 * `restore(draft)` puts a saved draft back. The first save after a
 * restore is skipped so the act of restoring never overwrites the
 * draft with the empty initial state.
 */
export default function useImportDraft({ businessId, mode, snapshot, restore }) {
  const [tooLarge, setTooLarge] = useState(false);
  const restoredFor = useRef(null);
  const skipSave = useRef(false);

  useEffect(() => {
    if (!businessId || restoredFor.current === businessId) return;
    restoredFor.current = businessId;
    skipSave.current = true;
    const draft = loadImportDraft(businessId, mode);
    if (draft) restore(draft);
  }, [businessId, mode]);

  const snapJson = snapshot ? JSON.stringify(snapshot) : '';
  useEffect(() => {
    if (!businessId || restoredFor.current !== businessId) return;
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    if (!snapshot || !snapshot.sheet || !snapshot.sheet.table) {
      clearImportDraft(businessId, mode);
      setTooLarge(false);
      return;
    }
    setTooLarge(!saveImportDraft(businessId, mode, snapshot));
  }, [businessId, mode, snapJson]);

  return { tooLarge };
}
