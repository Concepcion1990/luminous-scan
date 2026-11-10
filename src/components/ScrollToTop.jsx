import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

const MOBILE_TABS = new Set(['/', '/scan', '/products', '/orders', '/settings']);
const MOBILE_QUERY = '(max-width: 1023px)';

const getHashId = (hash) => {
  const rawId = hash.slice(1);

  try {
    return decodeURIComponent(rawId);
  } catch {
    return rawId;
  }
};

export default function ScrollToTop() {
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType();
  const tabScrollY = useRef(new Map());

  // Keep each tab's scroll offset even as the route changes and its mounted
  // content becomes hidden. The listener captures scrolling before navigation.
  useEffect(() => {
    if (!window.matchMedia(MOBILE_QUERY).matches || !MOBILE_TABS.has(pathname)) return undefined;
    const rememberPosition = () => tabScrollY.current.set(pathname, window.scrollY);
    window.addEventListener('scroll', rememberPosition, { passive: true });
    return () => window.removeEventListener('scroll', rememberPosition);
  }, [pathname]);

  // A workspace change must never restore a previous business's scroll offsets.
  useEffect(() => {
    const reset = () => tabScrollY.current.clear();
    window.addEventListener('stockhaven:reset-mobile-tab-scroll', reset);
    return () => window.removeEventListener('stockhaven:reset-mobile-tab-scroll', reset);
  }, []);

  useLayoutEffect(() => {
    if (hash) {
      if (navigationType === 'POP') return undefined;
      const id = getHashId(hash);
      const timer = window.setTimeout(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
      return () => window.clearTimeout(timer);
    }

    // Mobile tabs keep their DOM mounted. Restore the scroll position on return
    // instead of the usual route-change scroll-to-top.
    if (window.matchMedia(MOBILE_QUERY).matches && MOBILE_TABS.has(pathname)) {
      const y = tabScrollY.current.get(pathname) ?? 0;
      window.scrollTo({ top: y, left: 0, behavior: 'instant' });
      return undefined;
    }

    // Preserve the existing browser Back/Forward and desktop scroll behavior.
    if (navigationType === 'POP') return undefined;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    return undefined;
  }, [pathname, hash, navigationType]);

  return null;
}
