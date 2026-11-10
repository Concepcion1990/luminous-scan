import { Navigate } from 'react-router-dom';
import { useBusiness } from '@/hooks/useBusiness';
import { hasSeenWelcome } from '@/lib/welcome';

/**
 * The introduction comes before the first business, because creating that
 * business is what starts a trial. A device that has already seen it passes
 * straight through, and a login that owns a workspace is never redirected.
 */
export default function FirstLaunchRedirect() {
  const { businesses, isLoading } = useBusiness();

  if (isLoading) return null;
  if (businesses.length === 0 && !hasSeenWelcome()) {
    return <Navigate to="/welcome" replace />;
  }
  return null;
}