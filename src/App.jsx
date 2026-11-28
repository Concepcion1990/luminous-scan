import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { useEffect } from 'react';
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { isAuthPagePath } from './lib/authReturnTo';
import { shellShouldWait } from './lib/authReturnTo';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import PullToRefreshShell from './components/PullToRefreshShell';
import ProtectedRoute from '@/components/ProtectedRoute';
import Layout from '@/components/Layout';
import PlanRedirect from '@/components/plan/PlanRedirect';
import BossRedirect from '@/components/plan/BossRedirect';
import StaffWelcome from '@/pages/StaffWelcome';
import SubscriptionAccessRoute from '@/components/plan/SubscriptionAccessRoute';
import Upgrade from '@/pages/Upgrade';
import About from '@/pages/About';
import SubscriptionPolicy from '@/pages/SubscriptionPolicy';
import TermsOfService from '@/pages/TermsOfService';
import PrivacyPolicy from '@/pages/PrivacyPolicy';
import Dashboard from '@/pages/Dashboard';
import Scan from '@/pages/Scan';
import Products from '@/pages/Products';
import Inventory from '@/pages/Inventory';
import InventoryCategories from '@/pages/InventoryCategories';
import Categories from '@/pages/Categories';
import Materials from '@/pages/Materials';
import Restaurant from '@/pages/Restaurant';
import RestaurantRecipes from '@/pages/RestaurantRecipes';
import RestaurantShelf from '@/pages/RestaurantShelf';
import RecipeDetail from '@/pages/RecipeDetail';
import OrderGuide from '@/pages/OrderGuide';
import RestaurantInvoices from '@/pages/RestaurantInvoices';
import RestaurantWaste from '@/pages/RestaurantWaste';
import RestaurantExpiry from '@/pages/RestaurantExpiry';
import RestaurantAllergens from '@/pages/RestaurantAllergens';
import RestaurantTempLogs from '@/pages/RestaurantTempLogs';
import RestaurantSafetyLogs from '@/pages/RestaurantSafetyLogs';
import RestaurantInspectionPacket from '@/pages/RestaurantInspectionPacket';
import RestaurantCertificates from '@/pages/RestaurantCertificates';
import RestaurantMockInspection from '@/pages/RestaurantMockInspection';
import RestaurantSds from '@/pages/RestaurantSds';
import RestaurantKitchenDisplay from '@/pages/RestaurantKitchenDisplay';
import RestaurantGuestMenu from '@/pages/RestaurantGuestMenu';
import RestaurantTipPooling from '@/pages/RestaurantTipPooling';
import RestaurantLaborTarget from '@/pages/RestaurantLaborTarget';
import RestaurantCatering from '@/pages/RestaurantCatering';
import RestaurantReservations from '@/pages/RestaurantReservations';
import RestaurantStandingOrders from '@/pages/RestaurantStandingOrders';
import RestaurantProductionOrder from '@/pages/RestaurantProductionOrder';
import RestaurantBarCounting from '@/pages/RestaurantBarCounting';
import RestaurantLocationsRollup from '@/pages/RestaurantLocationsRollup';
import GuestMenuPublic from '@/pages/GuestMenuPublic';
import RestaurantEightySix from '@/pages/RestaurantEightySix';
import RestaurantTransfers from '@/pages/RestaurantTransfers';
import RestaurantStaffMeals from '@/pages/RestaurantStaffMeals';
import RestaurantMenu from '@/pages/RestaurantMenu';
import RestaurantVariance from '@/pages/RestaurantVariance';
import RestaurantPrep from '@/pages/RestaurantPrep';
import RestaurantLedger from '@/pages/RestaurantLedger';
import Listings from '@/pages/Listings';
import Locations from '@/pages/Locations';
import Movements from '@/pages/Movements';
import Valuation from '@/pages/Valuation';
import Reports from '@/pages/Reports';
import Alerts from '@/pages/Alerts';
import LowStock from '@/pages/LowStock';
import Settings from '@/pages/Settings';
import PrintCenter from '@/pages/PrintCenter';
import Exports from '@/pages/Exports';
import ImportCenter from '@/pages/ImportCenter';
import Staff from '@/pages/Staff';
import Orders from '@/pages/Orders';
import Returns from '@/pages/Returns';
import Counts from '@/pages/Counts';
import LogBook from '@/pages/LogBook';
import Checklists from '@/pages/Checklists';
import Equipment from '@/pages/Equipment';
import CrossStoreInbox from '@/pages/CrossStoreInbox';
import PosConnections from '@/pages/PosConnections';
import StorefrontConnections from '@/pages/StorefrontConnections';
import Workforce from '@/pages/Workforce';
import CrossStoreMessages from '@/pages/CrossStoreMessages';
import Training from '@/pages/Training';
import Payroll from '@/pages/Payroll';
import DirectDepositForm from '@/pages/DirectDepositForm';
import PayStubPrint from '@/pages/PayStubPrint';
import Purchasing from '@/pages/Purchasing';
import Suppliers from '@/pages/Suppliers';
import Welcome from '@/pages/Welcome';
import Plans from '@/pages/Plans';
import Subscribe from '@/pages/Subscribe';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import AccountRecovery from '@/pages/AccountRecovery';
import VerifyEmail from '@/pages/VerifyEmail';
import ThankYou from './pages/ThankYou';
import GraceInventory from '@/pages/GraceInventory';

const AuthenticatedApp = () => {
  const { isLoadingAuth, authError, isAuthenticated, user, navigateToLogin } = useAuth();
  const { pathname } = useLocation();
  // The introduction and the plan comparison are readable before signing in.
  // Public legal pages are readable too, including the /policies/* aliases
  // the app previously linked to, and both spellings of the Thank You page.
  // The About page is readable too.
  const openToEveryone = pathname.startsWith('/menu/') || pathname === '/welcome' || pathname === '/plans' || pathname === '/subscribe' || pathname === '/about' || pathname === '/subscription-policy' || pathname === '/policies/subscription' || pathname === '/terms-of-service' || pathname === '/policies/terms' || pathname === '/privacy-policy' || pathname === '/ThankYou' || pathname === '/thankyou';
  // The auth pages are never bounced either: they must render for
  // signed-out visitors exactly as they are, returnTo and all.
  const authPage = isAuthPagePath(pathname);

  // Redirect to login automatically when a signed-out visitor hits a
  // genuinely protected path. This lives in an effect — never during
  // render — and fires for protected paths only: public pages, the auth
  // pages, and "/" (handled below) are exempt. Before the 2026-11-12
  // fix this ran during render for every non-public path, /login
  // included, and each bounce wrapped the current URL inside a new
  // returnTo until the URL grew past the server limit (HTTP 431).
  useEffect(() => {
    if (authError?.type === 'auth_required' && !openToEveryone && !authPage && pathname !== '/') {
      navigateToLogin();
    }
  }, [authError, openToEveryone, authPage, pathname, navigateToLogin]);

  // The route table, built once and returned by the last exit below.
  // Building the element mounts nothing; the checks after it decide
  // whether this render shows the table, the spinner, or a redirect.
  const routes = (
    <Routes>
      <Route path="/welcome" element={<Welcome />} />
      <Route path="/menu/:slug" element={<GuestMenuPublic />} />
      <Route path="/plans" element={<Plans />} />
      <Route path="/subscribe" element={<Subscribe />} />
      <Route path="/about" element={<About />} />
      <Route path="/subscription-policy" element={<SubscriptionPolicy />} />
      <Route path="/policies/subscription" element={<SubscriptionPolicy />} />
      <Route path="/terms-of-service" element={<TermsOfService />} />
      <Route path="/policies/terms" element={<TermsOfService />} />
      <Route path="/privacy-policy" element={<PrivacyPolicy />} />
      {/* Thank You must sit ABOVE the "*" catch-all: a route declared after
          it is fragile, and the Stripe return URL is exactly "/ThankYou". */}
      <Route path="/ThankYou" element={<ThankYou />} />
      <Route path="/thankyou" element={<ThankYou />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/account-recovery" element={<AccountRecovery />} />

      <Route element={<ProtectedRoute unauthenticatedElement={<Login />} />}>
        {/* Read-only grace view: inside ProtectedRoute (login required) but
            OUTSIDE SubscriptionAccessRoute — a grace customer has no
            workspace access, only this page. The page itself checks the
            grace rule and redirects anyone not in grace. */}
        <Route path="/grace" element={<GraceInventory />} />
        <Route element={<SubscriptionAccessRoute />}>
          {/* The one-time staff welcome (Nov 19, 2026): inside the
              signed-in, subscription-checked shell but OUTSIDE the
              Layout — one warm screen, no clutter, before anything
              else. Layout sends a newly hired member here. */}
          <Route path="/staff-welcome" element={<StaffWelcome />} />
          <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/scan" element={<Scan />} />
          <Route path="/products" element={<Products />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/inventory/categories" element={<InventoryCategories />} />
          <Route path="/categories" element={<Categories />} />
          <Route
            path="/materials"
            element={
              <PlanRedirect feature="builds">
                <Materials />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant"
            element={
              <PlanRedirect feature="restaurant">
                <Restaurant />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/recipes"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantRecipes />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/recipes/:id"
            element={
              <PlanRedirect feature="restaurant">
                <RecipeDetail />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/kitchen"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantShelf shelfId="kitchen" />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/stock"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantShelf shelfId="stock" />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/money"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantShelf shelfId="money" />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/safety"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantShelf shelfId="safety" />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/floor"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantShelf shelfId="floor" />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/team"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantShelf shelfId="team" />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/locations"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantShelf shelfId="locations" />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/order-guide"
            element={
              <PlanRedirect feature="restaurant">
                <OrderGuide />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/invoices"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantInvoices />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/waste"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantWaste />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/expiry"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantExpiry />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/allergens"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantAllergens />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/temp-logs"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantTempLogs />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/safety-logs"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantSafetyLogs />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/inspection"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantInspectionPacket />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/certificates"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantCertificates />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/mock-inspection"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantMockInspection />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/sds"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantSds />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/kitchen-display"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantKitchenDisplay />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/guest-menu"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantGuestMenu />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/tip-pooling"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantTipPooling />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/labor-target"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantLaborTarget />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/catering"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantCatering />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/standing-orders"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantStandingOrders />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/production-order"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantProductionOrder />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/bar-counting"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantBarCounting />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/locations-rollup"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantLocationsRollup />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/reservations"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantReservations />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/86"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantEightySix />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/transfers"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantTransfers />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/staff-meals"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantStaffMeals />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/menu"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantMenu />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/variance"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantVariance />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/prep"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantPrep />
              </PlanRedirect>
            }
          />
          <Route
            path="/restaurant/ledger"
            element={
              <PlanRedirect feature="restaurant">
                <RestaurantLedger />
              </PlanRedirect>
            }
          />
          <Route path="/listings" element={<Listings />} />
          <Route path="/locations" element={<Locations />} />
          <Route path="/movements" element={<Movements />} />
          <Route
            path="/cross-store-inbox"
            element={
              <PlanRedirect feature="crossStore">
                <CrossStoreInbox />
              </PlanRedirect>
            }
          />
          <Route
            path="/cross-store-messages"
            element={
              <PlanRedirect feature="xstoreMessages">
                <CrossStoreMessages />
              </PlanRedirect>
            }
          />
          <Route
            path="/valuation"
            element={
              <PlanRedirect feature="valuation">
                <Valuation />
              </PlanRedirect>
            }
          />
          <Route
            path="/reports"
            element={
              <PlanRedirect feature="reports">
                <Reports />
              </PlanRedirect>
            }
          />
          <Route
            path="/alerts"
            element={
              <PlanRedirect feature="alerts" perm="alerts.view">
                <Alerts />
              </PlanRedirect>
            }
          />
          <Route
            path="/low-stock"
            element={
              <PlanRedirect feature="alerts" perm="alerts.view">
                <LowStock />
              </PlanRedirect>
            }
          />
          <Route path="/orders" element={<Orders />} />
          <Route
            path="/pos"
            element={
              <PlanRedirect feature="pos">
                <PosConnections />
              </PlanRedirect>
            }
          />
          {/* Storefront connections (release 362): BOTH PLANS by the owner's
              connection doctrine — deliberately NO PlanRedirect here. */}
          <Route path="/storefronts" element={<StorefrontConnections />} />
          <Route path="/returns" element={<Returns />} />
          <Route path="/counts" element={<Counts />} />
          {/* The manager log book (release 378): general, both
              plans — no plan redirect, like /counts. */}
          <Route path="/log-book" element={<LogBook />} />
          <Route path="/checklists" element={<Checklists />} />
          {/* Equipment records (plan release 372): general,
              both plans — no plan redirect, like /checklists. */}
          <Route path="/equipment" element={<Equipment />} />
          <Route
            path="/purchasing"
            element={
              <PlanRedirect feature="purchasing">
                <Purchasing />
              </PlanRedirect>
            }
          />
          <Route
            path="/suppliers"
            element={
              <PlanRedirect feature="suppliers">
                <Suppliers />
              </PlanRedirect>
            }
          />
          <Route path="/print" element={<PrintCenter />} />
          <Route
            path="/exports"
            element={
              <PlanRedirect feature="exports">
                <Exports />
              </PlanRedirect>
            }
          />
          <Route path="/import" element={<ImportCenter />} />
          <Route
            path="/upgrade"
            element={
              <BossRedirect>
                <Upgrade />
              </BossRedirect>
            }
          />
          <Route path="/staff" element={<Staff />} />
          <Route path="/workforce" element={<Workforce />} />
          <Route path="/training" element={<Training />} />
          <Route path="/payroll" element={<Payroll />} />
          <Route path="/payroll/direct-deposit-form" element={<DirectDepositForm />} />
          <Route path="/payroll/stub/:stubId" element={<PayStubPrint />} />
          <Route path="/settings" element={<Settings />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );

  // Show the loading spinner only while the session check is running
  // AND this path's destination depends on it (shellShouldWait).
  // Public pages and the auth pages render immediately, however cold
  // the server is: nothing on them waits on the session, and a
  // signed-out visitor's landing can no longer be swayed by how slow
  // the check is. "/" and the protected pages keep waiting, exactly
  // as before — their destination IS the session's answer.
  if (shellShouldWait({ openToEveryone, authPage, isLoadingAuth })) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-muted border-t-foreground rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    }
  }

  // Signed-out at the root: land once on the public face. Signed-in
  // visitors fall through to the routes, where "/" is the Dashboard
  // inside ProtectedRoute, exactly as before.
  if (pathname === '/' && !isAuthenticated) {
    return <Navigate to="/welcome" replace />;
  }

  // Recovery kit (T7): a restricted recovery session (a spare key was
  // presented, not a password) may see exactly ONE screen — the
  // change-email step. The server refuses everything else too; this
  // keeps the person on the one page that can finish the job.
  if (isAuthenticated && user?.session_scope === 'recovery' && pathname !== '/account-recovery') {
    return <Navigate to="/account-recovery" replace />;
  }

  // Render the main app
  return routes;
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <PullToRefreshShell>
            <AuthenticatedApp />
          </PullToRefreshShell>
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App