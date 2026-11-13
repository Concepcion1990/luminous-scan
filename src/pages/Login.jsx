import React, { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { loginWithMfa, continueMfa } from "@/lib/authMfa";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, LogIn, Mail, Lock, Loader2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import { safeReturnTo } from "@/lib/authReturnTo";
import { t, useLocale } from '@/lib/i18n';
import { readPendingVerificationEmail } from "./Register";

export default function Login() {
  // Public page (the picker lives in AuthLayout): re-render in the
  // visitor's language the moment the picker switches it.
  useLocale();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchParams] = useSearchParams();
  const resetSuccess = searchParams.get("reset") === "success";
  const [pendingEmail] = useState(readPendingVerificationEmail);
  // Post-login destination (e.g. the MCP OAuth consent page sends users here
  // with returnTo so the grant flow can resume). Same-origin paths only.
  const returnTo = safeReturnTo();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await loginWithMfa(email, password);
      if (result.mfa_required) {
        await continueMfa(result, returnTo);
        return;
      }
      window.location.href = returnTo;
    } catch (err) {
      setError(err.message || t('login.invalidCredentials'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      icon={LogIn}
      title={t('login.title')}
      subtitle={t('login.subtitle')}
      footer={
        <>
          {t('login.noAccount')}{" "}
          <Link
            to={"/register" + (returnTo !== "/" ? "?returnTo=" + encodeURIComponent(returnTo) : "")}
            className="text-link font-medium hover:underline"
          >
            {t('login.createOne')}
          </Link>{" "}
          ·{" "}
          <Link to="/plans" className="text-link font-medium hover:underline">
            {t('login.seePlans')}
          </Link>
        </>
      }
    >
      {resetSuccess && (
        <div className="mb-4 p-3 rounded-lg bg-ok/10 text-sm flex items-start gap-2">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
          <span>{t('login.resetSuccess')}</span>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">{t('auth.emailLabel')}</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder={t('auth.emailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-10 h-12"
              required
            />
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">{t('auth.passwordLabel')}</Label>
            <Link to="/forgot-password" className="text-xs text-link hover:underline">
              {t('login.forgotPassword')}
            </Link>
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pl-10 h-12"
              required
            />
          </div>
        </div>
        <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {t('login.loggingIn')}
            </>
          ) : (
            t('login.logIn')
          )}
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground mt-4">
        <Link to="/account-recovery" className="hover:underline">
          {t('login.cantAccessEmail')}
        </Link>
      </p>
      {pendingEmail && (
        <p className="text-center text-sm text-muted-foreground mt-4">
          {t('login.haveCodeFor', { email: pendingEmail })}{" "}
          <Link to="/verify-email" className="text-link font-medium hover:underline">
            {t('login.verifyEmailLink')}
          </Link>
        </p>
      )}
      {!pendingEmail && (
        <p className="text-center text-sm text-muted-foreground mt-4">
          {t('login.haveCode')}{" "}
          <Link to="/verify-email" className="text-link font-medium hover:underline">
            {t('login.verifyEmailLink')}
          </Link>
        </p>
      )}
    </AuthLayout>
  );
}