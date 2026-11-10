import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import ProtectedRoute from '@/components/ProtectedRoute';
import Layout from '@/components/Layout';
import PlanGate from '@/components/plan/PlanGate';
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
import Purchasing from '@/pages/Purchasing';
import Suppliers from '@/pages/Suppliers';
import Welcome from '@/pages/Welcome';
import Plans from '@/pages/Plans';
import Subscribe from '@/pages/Subscribe';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import VerifyEmail from '@/pages/VerifyEmail';
import ThankYou from './pages/ThankYou';
import GraceInventory from '@/pages/GraceInventory';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();
  const { pathname } = useLocation();
  // The introduction and the plan comparison are readable before signing in.
  // Public legal pages are readable too, including the /policies/* aliases
  // the app previously linked to, and both spellings of the Thank You page.
  // The About page is readable too.
  const openToEveryone = pathname === '/welcome' || pathname === '/plans' || pathname === '/subscribe' || pathname === '/about' || pathname === '/subscription-policy' || pathname === '/policies/subscription' || pathname === '/terms-of-service' || pathname === '/policies/terms' || pathname === '/privacy-policy' || pathname === '/ThankYou' || pathname === '/thankyou';

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required' && !openToEveryone) {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  // Render the main app
  return (
    <Routes>
      <Route path="/welcome" element={<Welcome />} />
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

      <Route element={<ProtectedRoute unauthenticatedElement={<Login />} />}>
        {/* Read-only grace view: inside ProtectedRoute (login required) but
            OUTSIDE SubscriptionAccessRoute — a grace customer has no
            workspace access, only this page. The page itself checks the
            grace rule and redirects anyone not in grace. */}
        <Route path="/grace" element={<GraceInventory />} />
        <Route element={<SubscriptionAccessRoute />}>
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
              <PlanGate feature="builds">
                <Materials />
              </PlanGate>
            }
          />
          <Route path="/listings" element={<Listings />} />
          <Route path="/locations" element={<Locations />} />
          <Route path="/movements" element={<Movements />} />
          <Route
            path="/valuation"
            element={
              <PlanGate feature="valuation">
                <Valuation />
              </PlanGate>
            }
          />
          <Route
            path="/reports"
            element={
              <PlanGate feature="reports">
                <Reports />
              </PlanGate>
            }
          />
          <Route
            path="/alerts"
            element={
              <PlanGate feature="alerts">
                <Alerts />
              </PlanGate>
            }
          />
          <Route
            path="/low-stock"
            element={
              <PlanGate feature="alerts">
                <LowStock />
              </PlanGate>
            }
          />
          <Route path="/orders" element={<Orders />} />
          <Route path="/returns" element={<Returns />} />
          <Route path="/counts" element={<Counts />} />
          <Route
            path="/purchasing"
            element={
              <PlanGate feature="purchasing">
                <Purchasing />
              </PlanGate>
            }
          />
          <Route
            path="/suppliers"
            element={
              <PlanGate feature="suppliers">
                <Suppliers />
              </PlanGate>
            }
          />
          <Route path="/print" element={<PrintCenter />} />
          <Route
            path="/exports"
            element={
              <PlanGate feature="exports">
                <Exports />
              </PlanGate>
            }
          />
          <Route path="/import" element={<ImportCenter />} />
          <Route path="/upgrade" element={<Upgrade />} />
          <Route path="/staff" element={<Staff />} />
          <Route path="/settings" element={<Settings />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App