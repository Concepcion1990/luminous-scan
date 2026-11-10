import React, { useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/client";
import { continueMfa } from "@/lib/authMfa";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserPlus, Mail, Lock, Loader2 } from "lucide-react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import AuthLayout from "@/components/AuthLayout";
import TrademarkNotice from "@/components/TrademarkNotice";
import { toast } from "@/components/ui/use-toast";
import { safeReturnTo } from "@/lib/authReturnTo";

/**
 * An email waiting on its verification code, so leaving the OTP screen
 * mid-verification does not strand the customer: Register and Login both
 * offer the resume path. Cleared once the code is verified.
 */
export const PENDING_VERIFICATION_KEY = "stockhaven.pendingVerificationEmail";

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
 * at least 8 characters, at most 72 bytes, no complexity requirement. */
export const PASSWORD_HINT = "At least 8 characters (up to 72 bytes). No special characters required.";

export default function Register() {
  const [email, setEmail] = useState("");
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
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      await base44.auth.register({ email, password });
      rememberPendingVerificationEmail(email);
      setPendingEmail(email);
      setShowOtp(true);
    } catch (err) {
      // Re-registering an email that already has a verified account does
      // not send a new code — the account already exists, so the customer
      // must sign in instead of waiting on an OTP screen that will never
      // receive one (seen live 2026-11-06: the Business test account
      // re-registered after its app data was cleaned up, and no code ever
      // arrived). Say so plainly and offer the login instead.
      const message = String(err.message || "");
      if (/already|exists|registered/i.test(message)) {
        setAlreadyExists(true);
        setError("An account with this email already exists. Sign in instead — a new code is only sent for a brand-new account.");
      } else {
        setError(message || "Registration failed");
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
      setError(err.message || "Invalid verification code");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError("");
    try {
      await base44.auth.resendOtp(email);
      toast({
        title: "Code sent",
        description: "Check your email for the new code.",
      });
    } catch (err) {
      setError(err.message || "Failed to resend code");
    }
  };

  // "Verify an emailed code" entry point: the customer left the OTP screen
  // after registering, or is returning with a code in hand. The OTP screen
  // itself says a new code is only sent for a brand-new account.
  const handleResumeCode = () => {
    setError("");
    if (!email.trim()) {
      setError("Enter the email the code was sent to first.");
      return;
    }
    setShowOtp(true);
  };

  if (showOtp) {
    return (
      <AuthLayout
        icon={Mail}
        title="Verify your email"
        subtitle={`We sent a code to ${email}`}
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
              Verifying...
            </>
          ) : (
            "Verify"
          )}
        </Button>
        <p className="text-center text-sm text-muted-foreground mt-4">
          Didn't receive the code?{" "}
          <button onClick={handleResend} className="text-primary font-medium hover:underline">
            Resend
          </button>
        </p>
        <p className="text-center text-sm text-muted-foreground">
          Already have an account with this email?{" "}
          <Link to={loginPath} className="text-primary font-medium hover:underline">
            Log in instead
          </Link>
        </p>
        <p className="text-center text-xs text-muted-foreground">
          A new code is only sent for a brand-new account. If you created an
          account with this email before, sign in with the password you set
          then — no new code will arrive.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      icon={UserPlus}
      title="Create your account"
      subtitle="Sign up to get started"
      footer={
        <>
          Already have an account?{" "}
          <Link
            to={loginPath}
            className="text-primary font-medium hover:underline"
          >
            Log in
          </Link>
        </>
      }
      below={
        <>
          <TrademarkNotice />
          <p className="mt-3 text-center text-sm">
            <Link to="/about" className="font-medium text-primary underline underline-offset-4">
              About Luminous StockHaven
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
              <Link to={loginPath} className="text-primary font-medium hover:underline">
                Sign in instead
              </Link>
            </div>
          )}
        </div>
      )}

      {pendingEmail && (
        <div className="mb-4 p-3 rounded-lg border border-border bg-muted/50 text-sm">
          <p>
            A verification code was sent to <span className="font-medium">{pendingEmail}</span>.
          </p>
          <button
            type="button"
            onClick={() => {
              setEmail(pendingEmail);
              setShowOtp(true);
            }}
            className="text-primary font-medium hover:underline mt-1"
          >
            Verify the code
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-10 h-12"
              required
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
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
          <p className="text-xs text-muted-foreground">{PASSWORD_HINT}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Confirm Password</Label>
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
              Creating account...
            </>
          ) : (
            "Create account"
          )}
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground mt-4">
        Already have a verification code?{" "}
        <button type="button" onClick={handleResumeCode} className="text-primary font-medium hover:underline">
          Verify an emailed code
        </button>
      </p>
    </AuthLayout>
  );
}
