import { useEffect, useState } from 'react';

const DESKTOP_QUERY = '(min-width: 1024px)';

/** True when the viewport is wide enough for the laptop layout. */
export default function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(DESKTOP_QUERY).matches
  );

  useEffect(() => {
    const media = window.matchMedia(DESKTOP_QUERY);
    const apply = () => setIsDesktop(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  return isDesktop;
}