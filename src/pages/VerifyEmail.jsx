import React, { useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, Loader2 } from "lucide-react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import AuthLayout from "@/components/AuthLayout";
import { toast } from "@/components/ui/use-toast";
import { safeReturnTo } from "@/lib/authReturnTo";
import { readPendingVerificationEmail, PENDING_VERIFICATION_KEY } from "./Register";
import { t, useLocale } from '@/lib/i18n';

/**
 * "Verify an emailed code" — the Finding 28 resume path as its own
 * page (linked from Login). The customer left the Register OTP screen
 * mid-verification, or is returning with a code in hand: they enter
 * the email the code was sent to plus the 6-digit code, and land back
 * where they were (the subscribe / workspace flow) once verified.
 * The pending email from Register is pre-filled when one exists.
 */
export default function VerifyEmail() {
  useLocale();
  const [email, setEmail] = useState(readPendingVerificationEmail);
  const [otpCode, setOtpCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const loginPath = "/login" + (safeReturnTo() !== "/" ? "?returnTo=" + encodeURIComponent(safeReturnTo()) : "");

  const handleVerify = async () => {
    setError("");
    if (!email.trim()) {
      setError(t('auth.enterEmailFirst'));
      return;
    }
    setLoading(true);
    try {
      await base44.auth.verifyOtp({ email: email.trim(), otpCode });
      try {
        localStorage.removeItem(PENDING_VERIFICATION_KEY);
      } catch {
        // Private mode or blocked storage: the session is verified anyway.
      }
      window.location.href = safeReturnTo();
    } catch (err) {
      const message = String(err.message || "");
      setError(message || t('auth.invalidVerificationCode'));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError("");
    if (!email.trim()) {
      setError(t('auth.enterEmailFirst'));
      return;
    }
    try {
      await base44.auth.resendOtp(email.trim());
      toast({
        title: t('auth.codeSentTitle'),
        description: t('auth.codeSentDescription'),
      });
    } catch (err) {
      setError(err.message || t('auth.failedToResendCode'));
    }
  };

  return (
    <AuthLayout
      icon={Mail}
      title={t('verifyEmail.title')}
      subtitle={t('verifyEmail.subtitle')}
      footer={
        <>
          {t('verifyEmail.alreadyVerified')}{" "}
          <Link to={loginPath} className="text-primary font-medium hover:underline">
            {t('verifyEmail.logIn')}
          </Link>
        </>
      }
    >
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          {error}
          {/already verified/i.test(error) && (
            <div className="mt-2">
              <Link to={loginPath} className="text-primary font-medium hover:underline">
                {t('verifyEmail.signInInstead')}
              </Link>
            </div>
          )}
        </div>
      )}
      <div className="space-y-4">
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
        <div className="flex justify-center">
          <InputOTP
            maxLength={6}
            value={otpCode}
            onChange={setOtpCode}
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
          disabled={loading || otpCode.length < 6 || !email.trim()}
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
        <p className="text-center text-sm text-muted-foreground">
          {t('verifyEmail.didntReceiveCode')}{" "}
          <button type="button" onClick={handleResend} className="text-primary font-medium hover:underline">
            {t('verifyEmail.resend')}
          </button>
        </p>
        <p className="text-center text-xs text-muted-foreground">
          {t('verifyEmail.newCodeOnlyNote')}
        </p>
      </div>
    </AuthLayout>
  );
}
