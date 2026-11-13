import { useCallback, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const MODAL_QUERY_KEY = 'stockhavenModal';
const PUSHED_MODAL_STATE_KEY = '__stockhavenModalPushed';

function withoutModalState(state) {
  const next = { ...(state || {}) };
  delete next[PUSHED_MODAL_STATE_KEY];
  return next;
}

/**
 * Close a URL-backed mobile dialog without accidentally navigating away from
 * a directly opened deep link. Returns true when a modal URL was handled.
 * Never modifies inventory, orders, accounts, or backend records.
 */
export function dismissActiveModal(navigate, location) {
  const params = new URLSearchParams(location.search);
  const currentModal = params.get(MODAL_QUERY_KEY);
  if (!currentModal) return false;

  const canPopOwnEntry =
    location.state?.[PUSHED_MODAL_STATE_KEY] === currentModal &&
    typeof window.history.state?.idx === 'number' &&
    window.history.state.idx > 0;

  if (canPopOwnEntry) {
    navigate(-1);
  } else {
    params.delete(MODAL_QUERY_KEY);
    const search = params.toString();
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash },
      { replace: true, state: withoutModalState(location.state) }
    );
  }
  return true;
}

/**
 * Mobile: the URL is the source of truth, so Android/browser Back closes an
 * overlay before it leaves the screen. The modal's opening creates one
 * history entry; a directly opened modal URL is dismissed with replace.
 *
 * Desktop: preserve the original in-memory open/close behavior.
 *
 * routePath disambiguates retained, hidden mobile tabs: dialogs from an
 * inactive tab cannot become visible over the current screen.
 */
export default function useModalHistory({ modalId, routePath, mobile }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [desktopOpen, setDesktopOpen] = useState(false);
  const currentModal = new URLSearchParams(location.search).get(MODAL_QUERY_KEY);
  const open = mobile
    ? location.pathname === routePath && currentModal === modalId
    : desktopOpen;

  const onOpenChange = useCallback((nextOpen) => {
    if (!mobile) {
      setDesktopOpen(Boolean(nextOpen));
      return;
    }

    // Ignore late Radix callbacks from a retained but inactive tab.
    if (location.pathname !== routePath) return;

    if (nextOpen) {
      if (currentModal === modalId) return;
      const params = new URLSearchParams(location.search);
      params.set(MODAL_QUERY_KEY, modalId);
      const search = params.toString();
      // A replaced deep-link modal did not create a history entry. Keep that
      // distinction, so closing the replacement cannot navigate off-page.
      const replacing = Boolean(currentModal);
      const ownsExistingEntry =
        replacing && location.state?.[PUSHED_MODAL_STATE_KEY] === currentModal;
      const nextState = withoutModalState(location.state);
      if (!replacing || ownsExistingEntry) {
        nextState[PUSHED_MODAL_STATE_KEY] = modalId;
      }
      navigate(
        { pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash },
        { replace: replacing, state: nextState }
      );
    } else if (currentModal === modalId) {
      dismissActiveModal(navigate, location);
    }
  }, [currentModal, location, modalId, mobile, navigate, routePath]);

  return { open, onOpenChange };
}
