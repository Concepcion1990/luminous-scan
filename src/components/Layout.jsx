import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ChevronDown, Loader2, Menu, Search } from 'lucide-react';
import AppMark from '@/components/brand/AppMark';
import LegalFooter from '@/components/LegalFooter';
import MerchantMark from '@/components/brand/MerchantMark';
import BusinessSwitcher from '@/components/business/BusinessSwitcher';
import { useBusiness } from '@/hooks/useBusiness';
import { PUBLISHER } from '@/lib/business';
import useStaffAccess from '@/hooks/useStaffAccess';
import useEntitlements from '@/hooks/useEntitlements';
import FirstLaunchRedirect from '@/components/plans/FirstLaunchRedirect';
import NoAccess from '@/components/staff/NoAccess';
import AccessPaused from '@/components/staff/AccessPaused';
import { NAV_GROUPS, NAV_ITEMS } from '@/components/layout/navGroups';
import useIsDesktop from '@/hooks/useIsDesktop';
import { dismissActiveModal } from '@/hooks/useModalHistory';
import Dashboard from '@/pages/Dashboard';
import Scan from '@/pages/Scan';
import Products from '@/pages/Products';
import Orders from '@/pages/Orders';
import Settings from '@/pages/Settings';

// The five mobile tab routes in App.jsx are direct screens. Render their
// components in stable, hidden layers so switching tabs doesn't reset a form,
// search, or mounted list. Desktop and all secondary routes still use Outlet.
const MOBILE_TAB_SCREENS = {
  '/': Dashboard,
  '/scan': Scan,
  '/products': Products,
  '/orders': Orders,
  '/settings': Settings,
};

export default function Layout() {
  const { profile, activeId } = useBusiness();
  const { loading: accessLoading, blocked, blockedReason, can } = useStaffAccess();
  // AUDIT FINDING 10: while the entitlement row loads, a missing row
  // resolves to restricted Essentials, so a Business login briefly lost
  // Purchasing, Suppliers, Stock value, Reports, Alerts, Exports and
  // Bundles from the nav, then got them back. Hold the nav at its loading
  // state until the plan is known — same unknown-null pattern as
  // PlanGate / Dashboard — instead of filtering on a plan that has not
  // arrived yet. The tab bar is unaffected: its five routes carry no
  // feature, only staff permissions (already loading-gated above).
  const { can: planAllows, isLoading: entitlementLoading } = useEntitlements();
  const location = useLocation();
  const { pathname } = location;
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const reduceMotion = useReducedMotion();
  const navigationType = useNavigationType();

  const animatePages = !isDesktop && !reduceMotion;
  const direction = navigationType === 'POP' ? -1 : 1;

  const pageVariants = {
    initial: (direction) => ({
      opacity: 0,
      x: direction * 14,
    }),
    animate: {
      opacity: 1,
      x: 0,
    },
    exit: (direction) => ({
      opacity: 0,
      x: direction * -14,
    }),
  };
  const [query, setQuery] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Two doors, both must open: the person's role and the plan's entitlements.
  const allowedItems = NAV_ITEMS.filter(
    (item) => (!item.perm || can(item.perm)) && (!item.feature || planAllows(item.feature))
  );
  // Mobile tabs and the full module menu use the exact same staff/plan filters as desktop.
  const mobileTabPaths = ['/', '/scan', '/products', '/orders', '/settings'];
  const mobileTabs = allowedItems.filter((item) => mobileTabPaths.includes(item.to));
  const mobileGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => allowedItems.includes(item)),
  })).filter((group) => group.items.length);
  const current = NAV_ITEMS.find((item) => item.to === pathname);
  const allowed = !current?.perm || can(current.perm);

  const lastWorkspaceRef = useRef(activeId);
  const [retainedTabs, setRetainedTabs] = useState({ businessId: activeId, paths: [] });
  const permittedTabPaths = mobileTabs.map((tab) => tab.to);
  const activeMobileTab = !isDesktop && permittedTabPaths.includes(pathname);
  const visitedPaths = retainedTabs.businessId === activeId ? retainedTabs.paths : [];
  const visibleLayers = permittedTabPaths.filter(
    (path) => visitedPaths.includes(path) || path === pathname
  );

  useEffect(() => {
    if (!activeMobileTab) return;
    setRetainedTabs((current) => {
      const paths = current.businessId === activeId ? current.paths : [];
      if (paths.includes(pathname) && current.businessId === activeId) return current;
      return { businessId: activeId, paths: [...paths, pathname] };
    });
  }, [activeId, activeMobileTab, pathname]);

  // Switching workspaces drops the retained screen layers AND their scroll offsets.
  useEffect(() => {
    if (lastWorkspaceRef.current === activeId) return;
    lastWorkspaceRef.current = activeId;
    window.dispatchEvent(new Event('stockhaven:reset-mobile-tab-scroll'));
    if (!isDesktop) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [activeId, isDesktop]);

  // Route changes, including browser Back/Forward, close the mobile module menu.
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // The laptop sidebar doubles as a finder: type a few letters to narrow the modules.
  const term = query.trim().toLowerCase();
  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => allowedItems.includes(item) && (!term || item.label.toLowerCase().includes(term))
    ),
  })).filter((group) => group.items.length);

  return (
    <div className="min-h-screen bg-background lg:flex">
      <FirstLaunchRedirect />
      <aside className="hidden w-[264px] shrink-0 flex-col bg-primary text-primary-foreground lg:sticky lg:top-0 lg:flex lg:h-screen">
        <div className="shrink-0 px-5 pb-3 pt-5">
          <AppMark />
        </div>

        <div className="mx-3 shrink-0 rounded-lg bg-primary-foreground/8 px-3 py-2.5">
          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-primary-foreground/40">
            Your business
          </p>
          <div className="mt-1.5">
            <MerchantMark profile={profile} showTagline />
          </div>
          <div className="mt-2.5 border-t border-primary-foreground/10 pt-2.5">
            <BusinessSwitcher />
          </div>
        </div>

        <div className="shrink-0 px-3 pb-1 pt-3">
          <label className="flex items-center gap-2 rounded-lg bg-primary-foreground/8 px-2.5 py-1.5 focus-within:ring-1 focus-within:ring-primary-foreground/40">
            <Search className="h-3.5 w-3.5 shrink-0 text-primary-foreground/40" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a screen"
              aria-label="Find a screen"
              className="w-full bg-transparent text-[13px] placeholder:text-primary-foreground/35 focus:outline-none"
            />
          </label>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          {entitlementLoading ? (
            <div className="space-y-2 px-3 py-2" aria-label="Loading screens">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-8 animate-pulse rounded-md bg-primary-foreground/10" />
              ))}
            </div>
          ) : (
            <>
              {groups.length === 0 && (
                <p className="px-3 py-4 text-xs text-primary-foreground/50">No screens match “{query}”.</p>
              )}
              {groups.map((group) => (
                <div key={group.label} className="mb-2.5">
                  <p className="px-3 pb-1 pt-2 font-mono text-[9px] uppercase tracking-[0.16em] text-primary-foreground/35">
                    {group.label}
                  </p>
                  <div className="space-y-0.5">
                    {group.items.map(({ to, label, icon: Icon, end }) => (
                      <NavLink
                        key={to}
                        to={to}
                        end={end}
                        className={({ isActive }) =>
                          [
                            'flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-foreground/50',
                            isActive
                              ? 'bg-primary-foreground/12 font-medium text-primary-foreground'
                              : 'text-primary-foreground/65 hover:bg-primary-foreground/8 hover:text-primary-foreground',
                          ].join(' ')
                        }
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {label}
                      </NavLink>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </nav>

        <div className="shrink-0 border-t border-primary-foreground/12 px-5 py-3.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary-foreground/40">
            Barcode · UPC · ISBN · QR
          </p>
          <p className="mt-1 text-xs leading-relaxed text-primary-foreground/60">
            Scan with your camera or a handheld reader.
          </p>
          <p className="mt-2 text-[10px] leading-snug text-primary-foreground/35">{PUBLISHER}</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 bg-primary text-primary-foreground lg:hidden">
          <div className="px-4 pb-2 pt-2.5">
            <div className="flex items-center gap-2">
              {pathname !== '/' && (
                <button
                  type="button"
                  onClick={() => {
                    // A mobile modal owns its history entry: Back should dismiss it
                    // before navigating to another screen or leaving the app.
                    if (dismissActiveModal(navigate, location)) return;
                    // Prefer in-app history; a directly opened deep link falls back to Overview.
                    const historyIndex = window.history.state?.idx;
                    if (typeof historyIndex === 'number' && historyIndex > 0) {
                      navigate(-1);
                    } else {
                      navigate('/', { replace: true });
                    }
                  }}
                  aria-label="Go back"
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-primary-foreground/20 text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground/60"
                >
                  <ArrowLeft className="h-5 w-5" aria-hidden="true" />
                </button>
              )}
              <AppMark compact />
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-3">
              <MerchantMark profile={profile} />
              {can('scan.use') && (
                <NavLink
                  to="/scan"
                  className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground"
                >
                  Scan
                </NavLink>
              )}
            </div>
            <div className="mt-2">
              <BusinessSwitcher compact />
            </div>
          </div>
          <div className="border-t border-primary-foreground/10 px-4 py-2">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((open) => !open)}
              aria-expanded={mobileMenuOpen}
              aria-controls="stockhaven-mobile-modules"
              className="flex min-h-10 w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium text-primary-foreground/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground/60"
            >
              <span className="flex items-center gap-2">
                <Menu className="h-4 w-4" aria-hidden="true" />
                All screens
              </span>
              <ChevronDown
                className={`h-4 w-4 transition-transform ${mobileMenuOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>
          </div>
          <nav
            id="stockhaven-mobile-modules"
            aria-label="All business screens"
            hidden={!mobileMenuOpen}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setMobileMenuOpen(false);
              }
            }}
            className="max-h-[65vh] overflow-y-auto border-t border-primary-foreground/10 px-3 pb-3 pt-2"
          >
            {entitlementLoading ? (
              <div className="space-y-2 px-2 py-2" aria-label="Loading screens">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-11 animate-pulse rounded-md bg-primary-foreground/10" />
                ))}
              </div>
            ) : (
              mobileGroups.map((group) => (
                <div key={group.label} className="mb-2">
                  <p className="px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-primary-foreground/50">
                    {group.label}
                  </p>
                  <div className="grid grid-cols-2 gap-1">
                    {group.items.map(({ to, label, icon: Icon, end }) => (
                      <NavLink
                        key={to}
                        to={to}
                        end={end}
                        onClick={() => setMobileMenuOpen(false)}
                        className={({ isActive }) =>
                          [
                            'flex min-h-11 items-center gap-2 rounded-md px-2 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground/60',
                            isActive
                              ? 'bg-primary-foreground/15 font-semibold text-primary-foreground'
                              : 'text-primary-foreground/75 hover:bg-primary-foreground/10',
                          ].join(' ')
                        }
                      >
                        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>{label}</span>
                      </NavLink>
                    ))}
                  </div>
                </div>
              ))
            )}
          </nav>
        </header>

        <main className="stockhaven-mobile-content flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 xl:px-10">
          <div className="mx-auto w-full max-w-[1400px]">
            {accessLoading ? (
              <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Checking your access…
              </div>
            ) : blocked || blockedReason === 'pending' ? (
              <AccessPaused reason={blockedReason} />
            ) : allowed ? (
              isDesktop ? (
                <Outlet />
              ) : (
                <>
                  {visibleLayers.map((tabPath) => {
                    const TabScreen = MOBILE_TAB_SCREENS[tabPath];
                    const active = activeMobileTab && pathname === tabPath;
                    return (
                      <motion.div
                        key={`${activeId || 'workspace'}:${tabPath}`}
                        data-mobile-tab={tabPath}
                        aria-hidden={!active}
                        style={{ display: active ? 'block' : 'none' }}
                        initial={false}
                        animate={{
                          opacity: active ? 1 : 0,
                          x: active || reduceMotion ? 0 : direction * 14,
                        }}
                        transition={{
                          duration: reduceMotion ? 0 : 0.16,
                          ease: 'easeOut',
                        }}
                      >
                        <TabScreen />
                      </motion.div>
                    );
                  })}
                  {!activeMobileTab && (
                    animatePages ? (
                      <AnimatePresence initial={false} mode="wait" custom={direction}>
                        <motion.div
                          key={pathname}
                          custom={direction}
                          variants={pageVariants}
                          initial="initial"
                          animate="animate"
                          exit="exit"
                          transition={{ duration: 0.16, ease: 'easeOut' }}
                        >
                          <Outlet />
                        </motion.div>
                      </AnimatePresence>
                    ) : (
                      <Outlet />
                    )
                  )}
                </>
              )
            ) : (
              <NoAccess permission={current?.perm} />
            )}
          </div>

          {/* Small, centered copyright line at the bottom of every
              protected page. The bottom padding clears the fixed mobile
              tab bar; on desktop it sits tight under the content. */}
          <LegalFooter className="pb-20 lg:pb-4" />
        </main>

        <nav
          aria-label="Primary mobile navigation"
          className="stockhaven-mobile-tabbar fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card shadow-lg lg:hidden"
        >
          <div className="mx-auto flex min-h-[64px] max-w-xl items-stretch justify-around px-1">
            {mobileTabs.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  [
                    'flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-md px-1 py-2 text-center text-[10px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isActive
                      ? 'text-primary'
                      : 'text-muted-foreground hover:text-foreground',
                  ].join(' ')
                }
              >
                <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className="truncate">{label}</span>
              </NavLink>
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
}