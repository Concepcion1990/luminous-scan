/**
 * Staged-import drafts (owner ruling, Nov 14, 2026): an in-progress
 * import — the parsed file, the column matches, the operation
 * inputs and the dry-run verdict — lives on THIS device only, so
 * leaving, reloading, or the browser closing never wipes it.
 * 'Start over' (or finishing the import) is the only discard.
 * Nothing here reaches the server; the draft is pure client state.
 */

const PREFIX = 'sh_import_draft:';
// A parsed 500-row sheet is a few hundred KB of JSON; the guard
// keeps a giant workbook from silently failing later — the caller
// says so plainly at staging time instead.
export const MAX_DRAFT_CHARS = 4_000_000;

export function importDraftKey(businessId, mode) {
  return `${PREFIX}${businessId}:${mode}`;
}

export function saveImportDraft(businessId, mode, snapshot) {
  try {
    const json = JSON.stringify({ version: 1, savedAt: Date.now(), ...snapshot });
    if (json.length > MAX_DRAFT_CHARS) return false;
    localStorage.setItem(importDraftKey(businessId, mode), json);
    return true;
  } catch {
    return false;
  }
}

export function loadImportDraft(businessId, mode) {
  try {
    const raw = localStorage.getItem(importDraftKey(businessId, mode));
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft || draft.version !== 1 || !draft.sheet || !draft.sheet.table) return null;
    return draft;
  } catch {
    return null;
  }
}

export function clearImportDraft(businessId, mode) {
  try {
    localStorage.removeItem(importDraftKey(businessId, mode));
  } catch {
    /* storage unavailable — nothing to clear */
  }
}
