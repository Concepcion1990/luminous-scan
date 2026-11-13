import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound, Loader2, Mail, LifeBuoy } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import ChangeEmailForm from "@/components/ChangeEmailForm";
import { apiRequest } from "@/api/client";
import { t, useLocale } from "@/lib/i18n";
import {
  recoverWithBackupCode,
  requestRecoveryCode,
  verifyRecoveryCode,
} from "@/lib/recovery";

/**
 * "Can't get into your email?" — the spare-key door.
 *
 * A customer who lost access to their account email proves who they
 * are with a spare key they set up while signed in: one backup code,
 * or a 6-digit code sent to their verified backup email. Success
 * mints a RESTRICTED recovery session (server-enforced: it can reach
 * only this page's change-email step) — never a full sign-in. The
 * moment the email change completes, the session graduates and the
 * shop is theirs again, exactly as they left it.
 */
export default function AccountRecovery() {
  useLocale();
  const [step, setStep] = useState("checking"); // checking -> start -> code -> change -> done
  const [fullSession, setFullSession] = useState(false);
  const [email, setEmail] = useState("");
  const [backupCode, setBackupCode] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await apiRequest("/api/auth/me");
        if (cancelled) return;
        if (me?.session_scope === "recovery") {
          setFullSession(false);
          setStep("change");
        } else {
          // Already signed in normally — the same step, with the
          // password proof the server asks of full sessions.
          setFullSession(true);
          setStep("change");
        }
      } catch {
        if (!cancelled) setStep("start");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const useBackupCode = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await recoverWithBackupCode(email.trim(), backupCode.trim());
      setFullSession(false);
      setStep("change");
    } catch (err) {
      setError(err?.message || t("recovery.genericError"));
    } finally {
      setBusy(false);
    }
  };

  const emailMeCode = async () => {
    setError("");
    setBusy(true);
    try {
      await requestRecoveryCode(email.trim());
      // Always advance: the server's answer never reveals whether a
      // code was really sent (no enumeration).
      setStep("code");
    } catch (err) {
      setError(err?.message || t("recovery.genericError"));
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await verifyRecoveryCode(email.trim(), code.trim());
      setFullSession(false);
      setStep("change");
    } catch (err) {
      setError(err?.message || t("recovery.genericError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      icon={LifeBuoy}
      title={t("recovery.title")}
      subtitle={t("recovery.subtitle")}
      footer={
        <>
          {t("recovery.remembered")}{" "}
          <Link to="/login" className="text-primary font-medium hover:underline">
            {t("recovery.backToLogin")}
          </Link>
        </>
      }
    >
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>
      )}

      {step === "checking" && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {step === "start" && (
        <div className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="recovery-email">{t("recovery.emailLabel")}</Label>
            <Input
              id="recovery-email"
              type="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12"
              required
            />
          </div>

          <form onSubmit={useBackupCode} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="recovery-backup-code">{t("recovery.backupCodeLabel")}</Label>
              <Input
                id="recovery-backup-code"
                autoComplete="off"
                placeholder="ABCD-2345"
                value={backupCode}
                onChange={(e) => setBackupCode(e.target.value)}
                className="h-12 tracking-widest uppercase"
              />
              <p className="text-xs text-muted-foreground">{t("recovery.backupCodeHint")}</p>
            </div>
            <Button type="submit" className="w-full h-12 font-medium" disabled={busy || !email || !backupCode.trim()}>
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <KeyRound className="w-4 h-4 mr-2" />}
              {t("recovery.useBackupCode")}
            </Button>
          </form>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            {t("recovery.orDivider")}
            <span className="h-px flex-1 bg-border" />
          </div>

          <div className="space-y-2">
            <Button
              type="button"
              variant="outline"
              className="w-full h-12 font-medium"
              disabled={busy || !email}
              onClick={emailMeCode}
            >
              <Mail className="w-4 h-4 mr-2" />
              {t("recovery.emailMeCode")}
            </Button>
            <p className="text-xs text-muted-foreground">{t("recovery.emailMeCodeHint")}</p>
          </div>
        </div>
      )}

      {step === "code" && (
        <form onSubmit={verifyCode} className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("recovery.codeSent")}</p>
          <div className="space-y-2">
            <Label htmlFor="recovery-code">{t("recovery.codeLabel")}</Label>
            <Input
              id="recovery-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="h-12 tracking-widest"
              required
            />
          </div>
          <Button type="submit" className="w-full h-12 font-medium" disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            {t("recovery.verifyCode")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => { setStep("start"); setCode(""); setError(""); }}
          >
            {t("recovery.startOver")}
          </Button>
        </form>
      )}

      {step === "change" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("recovery.changeIntro")}</p>
          <ChangeEmailForm
            requirePassword={fullSession}
            onChanged={() => setStep("done")}
          />
        </div>
      )}

      {step === "done" && (
        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-ok/10 text-sm">{t("recovery.doneBody")}</div>
          <Button className="w-full h-12 font-medium" onClick={() => { window.location.href = "/"; }}>
            {t("recovery.doneButton")}
          </Button>
        </div>
      )}
    </AuthLayout>
  );
}
