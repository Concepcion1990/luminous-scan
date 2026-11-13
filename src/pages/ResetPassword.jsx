import React, { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { base44 } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, Loader2, AlertTriangle, KeyRound } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import { getPasswordHint } from "./Register";
import { t, useLocale } from '@/lib/i18n';

export default function ResetPassword() {
  useLocale();
  const [searchParams] = useSearchParams();
  const urlToken = searchParams.get("token");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Code entry: the reset email carries a 6-digit code as well as the
  // link, and the server accepts that code as the reset token. A code
  // typed here (shape-checked) becomes the token, so a visitor whose
  // link arrived mangled — or who lands on /reset-password with no
  // ?token at all — can still finish the reset the email promised.
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [enteredCode, setEnteredCode] = useState(null);
  const [codeEntryOpen, setCodeEntryOpen] = useState(false);

  const resetToken = enteredCode ?? urlToken;

  const handleCodeSubmit = (e) => {
    e.preventDefault();
    const candidate = code.trim();
    if (!/^\d{6}$/.test(candidate)) {
      setCodeError(t('reset.codeInvalid'));
      return;
    }
    setCodeError("");
    setEnteredCode(candidate);
    setCodeEntryOpen(false);
  };

  const codeEntryForm = (
    <form onSubmit={handleCodeSubmit} className="mt-5 space-y-4">
      <p className="text-sm text-foreground text-center">{t('reset.codePrompt')}</p>
      <div className="space-y-2">
        <Label htmlFor="reset-code">{t('reset.codeLabel')}</Label>
        <div className="relative">
          <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <Input
            id="reset-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="••••••"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="pl-10 h-12"
            maxLength={6}
          />
        </div>
      </div>
      {codeError && (
        <div role="alert" className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          {codeError}
        </div>
      )}
      <Button type="submit" className="w-full h-12 font-medium">
        {t('reset.codeContinue')}
      </Button>
    </form>
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError(t('auth.passwordsDoNotMatch'));
      return;
    }
    setLoading(true);
    try {
      await base44.auth.resetPassword({ resetToken, newPassword });
      window.location.href = "/login?reset=success";
    } catch (err) {
      setError(err.message || t('reset.failed'));
    } finally {
      setLoading(false);
    }
  };

  // Arrived WITH a token, but the visitor asked to type a code instead
  // (a mangled link is the usual reason): the entry form takes over,
  // and a well-formed code swaps in as the token.
  if (resetToken && codeEntryOpen) {
    return (
      <AuthLayout
        icon={KeyRound}
        title={t('reset.title')}
        subtitle={t('reset.subtitle')}
      >
        {codeEntryForm}
      </AuthLayout>
    );
  }

  if (!resetToken) {
    return (
      <AuthLayout
        icon={AlertTriangle}
        title={t('reset.invalidTitle')}
        subtitle={t('reset.invalidSubtitle')}
        footer={
          <Link to="/forgot-password" className="text-link font-medium hover:underline">
            {t('reset.requestNewLink')}
          </Link>
        }
      >
        <p className="text-sm text-foreground text-center">
          {t('reset.invalidBody')}
        </p>
        {codeEntryForm}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      icon={Lock}
      title={t('reset.title')}
      subtitle={t('reset.subtitle')}
    >
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">{t('reset.newPasswordLabel')}</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              autoFocus
              placeholder="••••••••"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="pl-10 h-12"
              minLength={8}
              required
            />
          </div>
          <p className="text-xs text-muted-foreground">{getPasswordHint()}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">{t('reset.confirmPasswordLabel')}</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="pl-10 h-12"
              required
            />
          </div>
        </div>
        <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {t('reset.resetting')}
            </>
          ) : (
            t('reset.resetPassword')
          )}
        </Button>
      </form>
      {enteredCode === null && (
        <p className="mt-4 text-center text-sm text-muted-foreground">
          <button
            type="button"
            onClick={() => setCodeEntryOpen(true)}
            className="text-link font-medium hover:underline"
          >
            {t('reset.useCodeInstead')}
          </button>
        </p>
      )}
    </AuthLayout>
  );
}
