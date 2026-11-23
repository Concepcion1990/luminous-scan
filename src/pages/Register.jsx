import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/client";
import { continueMfa } from "@/lib/authMfa";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserPlus, Mail, Lock, Loader2 } from "lucide-react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import AuthLayout from "@/components/AuthLayout";
import SameEmailNotice from "@/components/SameEmailNotice";
import TrademarkNotice from "@/components/TrademarkNotice";
import { toast } from "@/components/ui/use-toast";
import { safeReturnTo } from "@/lib/authReturnTo";
import { t, useLocale } from '@/lib/i18n';

/**
 * An email waiting on its verification code, so leaving the OTP screen
 * mid-verification does not strand the customer: Register and Login both
 * offer the resume path. Cleared once the code is verified.
 */
export const PENDING_VERIFICATION_KEY = "stockhaven.pendingVerificationEmail";

/** The invite-link claim for this browser session (single-use
 * invite links, Nov 22, 2026): { token, claim } for the link
 * this session opened first. sessionStorage dies with the
 * tab/session — which is exactly the link's one visit. */
const INVITE_CLAIM_KEY = "stockhaven.inviteClaim";

export function readPendingVerificationEmail() {
  try {
    return localStorage.getItem(PENDING_VERIFICATION_KEY) || "";
  } catch {
    return "";
  }
}

function rememberPendingVerificationEmail(email) {
  try {
    localStorage.setItem(PENDING_VERIFICATION_KEY, email);
  } catch {
    // Private mode or blocked storage: the in-page OTP screen still works.
  }
}

function forgetPendingVerificationEmail() {
  try {
    localStorage.removeItem(PENDING_VERIFICATION_KEY);
  } catch {
    // Nothing to clean up.
  }
}

/** Base44's password rule (docs.base44.com, Auth Module, verified 2026-11-08):
 * at least 8 characters, at most 72 bytes, no complexity requirement.
 * T6.3: a function, not an import-time t() call, so the hint follows the
 * live locale instead of freezing at module load. */
export function getPasswordHint() { return t('register.passwordHint'); }

export default function Register() {
  // Public page (the picker lives in AuthLayout): re-render in the
  // visitor's language the moment the picker switches it.
  useLocale();
  // The staff invitation email links straight here with the
  // invited address in the query (?email=…), so a new hire lands
  // on this page with their email already filled in — no hunting
  // from the sign-in page (owner's ruling, Nov 19, 2026). The
  // address stays fully editable.
  //
  // Single-use invite links (owner's ruling, Nov 22, 2026): the
  // email's link also carries a one-use token (?invite=…). The
  // first open claims the link for THIS browser session (the
  // claim lives in sessionStorage); finishing the signup in
  // this same visit consumes it. A link opened and left, or
  // opened by another session, is refused with a kind message
  // and the owner sends a fresh invite. Legacy links (no
  // token) keep the old email-match connection, exactly as
  // before.
  const [email, setEmail] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get("email") || "";
    } catch {
      return "";
    }
  });
  const [inviteToken] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get("invite") || "";
    } catch {
      return "";
    }
  });
  // 'none' (no token) | 'checking' | 'ready' | 'spent' | 'connected'
  const [inviteState, setInviteState] = useState(inviteToken ? "checking" : "none");
  const [inviteClaim, setInviteClaim] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const inviteOpenStarted = useRef(false);

  useEffect(() => {
    if (!inviteToken || inviteOpenStarted.current) return;
    inviteOpenStarted.current = true;
    let storedClaim = "";
    try {
      const raw = sessionStorage.getItem(INVITE_CLAIM_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && parsed.token === inviteToken && parsed.claim) storedClaim = parsed.claim;
    } catch {
      storedClaim = "";
    }
    (async () => {
      try {
        const result = await base44.auth.openInviteLink({ token: inviteToken, claim: storedClaim || undefined });
        if (result?.completed) {
          setInviteState("connected");
          return;
        }
        if (result?.claim) {
          setInviteClaim(result.claim);
          try {
            sessionStorage.setItem(INVITE_CLAIM_KEY, JSON.stringify({ token: inviteToken, claim: result.claim }));
          } catch {
            // Private mode: the in-state claim still covers this visit.
          }
        }
        if (result?.email) setEmail(result.email);
        setInviteState("ready");
      } catch (err) {
        if (err?.data?.error === "invite_link_used") {
          setInviteMessage(err.message || t('apiErrors.inviteLinkUsed'));
          setInviteState("spent");
        } else {
          // The open call itself failed (network, server hiccup):
          // never declare the link spent on a guess. The visit
          // proceeds as a plain signup; the invite simply is not
          // bound, and the owner can resend.
          setInviteState("none");
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteToken]);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showOtp, setShowOtp] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [alreadyExists, setAlreadyExists] = useState(false);
  const [pendingEmail, setPendingEmail] = useState(readPendingVerificationEmail);
  const loginPath = "/login" + (safeReturnTo() !== "/" ? "?returnTo=" + encodeURIComponent(safeReturnTo()) : "");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError(t('auth.passwordsDoNotMatch'));
      return;
    }
    setLoading(true);
    try {
      await base44.auth.register({
        email,
        password,
        inviteToken: inviteState === "ready" && inviteClaim ? inviteToken : undefined,
        inviteClaim: inviteState === "ready" && inviteClaim ? inviteClaim : undefined,
      });
      rememberPendingVerificationEmail(email);
      setPendingEmail(email);
      setShowOtp(true);
    } catch (err) {
      // The invite link died between opening and submitting
      // (spent by another session): show the kind message in
      // place of the form, exactly as an open-time refusal does.
      if (err?.data?.error === "invite_link_used") {
        setInviteMessage(err.message || t('apiErrors.inviteLinkUsed'));
        setInviteState("spent");
        setLoading(false);
        return;
      }
      // Re-registering an email that already has a verified account does
      // not send a new code — the account already exists, so the customer
      // must sign in instead of waiting on an OTP screen that will never
      // receive one (seen live 2026-11-06: the Business test account
      // re-registered after its app data was cleaned up, and no code ever
      // arrived). Say so plainly and offer the login instead.
      const message = String(err.message || "");
      if (err?.data?.error === "already_registered" || /already|exists|registered/i.test(message)) {
        setAlreadyExists(true);
        setError(t('register.alreadyExists'));
      } else {
        setError(message || t('register.registrationFailed'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    setError("");
    setLoading(true);
    try {
      const result = await base44.auth.verifyOtp({ email, otpCode });
      forgetPendingVerificationEmail();
      setPendingEmail("");
      if (result?.mfa_required) {
        // The account is already verified, so a retry here would fail; sign in again instead.
        await continueMfa(result, safeReturnTo()).catch(() => window.location.assign(loginPath));
        return;
      }
      if (result?.access_token) {
        base44.auth.setToken(result.access_token);
      }
      window.location.href = safeReturnTo();
    } catch (err) {
      setError(err.message || t('auth.invalidVerificationCode'));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError("");
    try {
      await base44.auth.resendOtp(email);
      toast({
        title: t('auth.codeSentTitle'),
        description: t('auth.codeSentDescription'),
      });
    } catch (err) {
      setError(err.message || t('auth.failedToResendCode'));
    }
  };

  // "Verify an emailed code" entry point: the customer left the OTP screen
  // after registering, or is returning with a code in hand. The OTP screen
  // itself says a new code is only sent for a brand-new account.
  const handleResumeCode = () => {
    setError("");
    if (!email.trim()) {
      setError(t('auth.enterEmailFirst'));
      return;
    }
    setShowOtp(true);
  };

  // Single-use invite link states (Nov 22, 2026): while the
  // link is being opened the form waits; a spent link shows
  // the kind message with the sign-in door; a signed-in
  // acceptance shows the connected panel.
  if (inviteToken && inviteState === "checking") {
    return (
      <AuthLayout icon={UserPlus} title={t('register.title')} subtitle={t('register.subtitle')}>
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </AuthLayout>
    );
  }

  if (inviteToken && inviteState === "spent") {
    return (
      <AuthLayout
        icon={Mail}
        title={t('register.title')}
        subtitle={t('register.subtitle')}
        footer={
          <>
            {t('register.alreadyHaveAccount')}{" "}
            <Link to={loginPath} className="text-link font-medium hover:underline">
              {t('register.logIn')}
            </Link>
          </>
        }
      >
        <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          {inviteMessage || t('apiErrors.inviteLinkUsed')}
        </div>
      </AuthLayout>
    );
  }

  if (inviteToken && inviteState === "connected") {
    return (
      <AuthLayout icon={UserPlus} title={t('register.title')} subtitle={t('register.subtitle')}>
        <div className="p-3 rounded-lg border border-border bg-muted/50 text-sm mb-4">
          {t('register.inviteConnected')}
        </div>
        <Link to={safeReturnTo()}>
          <Button className="w-full h-12 font-medium">{t('register.inviteOpenApp')}</Button>
        </Link>
      </AuthLayout>
    );
  }

  if (showOtp) {
    return (
      <AuthLayout
        icon={Mail}
        title={t('verifyEmail.title')}
        subtitle={t('register.otpSubtitle', { email })}
      >
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
            {error}
          </div>
        )}
        <div className="flex justify-center mb-6">
          <InputOTP
            maxLength={6}
            value={otpCode}
            onChange={setOtpCode}
            autoFocus
            autoComplete="one-time-code"
          >
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
        </div>
        <Button
          className="w-full h-12 font-medium"
          onClick={handleVerify}
          disabled={loading || otpCode.length < 6}
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {t('verifyEmail.verifying')}
            </>
          ) : (
            t('verifyEmail.verify')
          )}
        </Button>
        <p className="text-center text-sm text-muted-foreground mt-4">
          {t('verifyEmail.didntReceiveCode')}{" "}
          <button onClick={handleResend} className="text-link font-medium hover:underline">
            {t('verifyEmail.resend')}
          </button>
        </p>
        <p className="text-center text-sm text-muted-foreground">
          {t('register.alreadyHaveAccountWithEmail')}{" "}
          <Link to={loginPath} className="text-link font-medium hover:underline">
            {t('register.logInInstead')}
          </Link>
        </p>
        <p className="text-center text-xs text-muted-foreground">
          {t('verifyEmail.newCodeOnlyNote')}
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      icon={UserPlus}
      title={t('register.title')}
      subtitle={t('register.subtitle')}
      footer={
        <>
          {t('register.alreadyHaveAccount')}{" "}
          <Link
            to={loginPath}
            className="text-link font-medium hover:underline"
          >
            {t('register.logIn')}
          </Link>
        </>
      }
      below={
        <>
          <TrademarkNotice />
          <p className="mt-3 text-center text-sm">
            <Link to="/about" className="font-medium text-link underline underline-offset-4">
              {t('auth.aboutLink')}
            </Link>
          </p>
        </>
      }
    >
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          {error}
          {alreadyExists && (
            <div className="mt-2">
              <Link to={loginPath} className="text-link font-medium hover:underline">
                {t('register.signInInstead')}
              </Link>
            </div>
          )}
        </div>
      )}

      {pendingEmail && (
        <div className="mb-4 p-3 rounded-lg border border-border bg-muted/50 text-sm">
          <p>
            {t('register.codeSentToBefore')} <span className="font-medium">{pendingEmail}</span>{t('register.codeSentToAfter')}
          </p>
          <button
            type="button"
            onClick={() => {
              setEmail(pendingEmail);
              setShowOtp(true);
            }}
            className="text-link font-medium hover:underline mt-1"
          >
            {t('register.verifyCode')}
          </button>
        </div>
      )}

      <SameEmailNotice className="mb-4" />

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
          <Label htmlFor="password">{t('auth.passwordLabel')}</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pl-10 h-12"
              minLength={8}
              required
            />
          </div>
          <p className="text-xs text-muted-foreground">{getPasswordHint()}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">{t('register.confirmPasswordLabel')}</Label>
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
              {t('register.creatingAccount')}
            </>
          ) : (
            t('register.createAccount')
          )}
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground mt-4">
        {t('register.alreadyHaveCode')}{" "}
        <button type="button" onClick={handleResumeCode} className="text-link font-medium hover:underline">
          {t('register.verifyEmailedCode')}
        </button>
      </p>
    </AuthLayout>
  );
}
