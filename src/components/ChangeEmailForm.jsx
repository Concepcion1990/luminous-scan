import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, Loader2, Mail } from "lucide-react";
import { t } from "@/lib/i18n";
import { requestEmailChange, confirmEmailChange } from "@/lib/recovery";

/**
 * The change-email flow, shared by Settings → Security (the normal
 * path: current password + a code to the NEW email) and the recovery
 * page (the emergency path: a recovery session already proved itself
 * with a spare key, so no password is asked). On success the account
 * — shop, staff seats, trial history and all — lives under the new
 * email, and every other session is signed out by the server.
 */
export default function ChangeEmailForm({ requirePassword = true, onChanged }) {
  const [step, setStep] = useState("form"); // form -> code -> done
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const start = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await requestEmailChange(newEmail.trim(), requirePassword ? password : undefined);
      setStep("code");
    } catch (err) {
      setError(err?.message || t("settings.security.genericError"));
    } finally {
      setBusy(false);
    }
  };

  const finish = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await confirmEmailChange(code.trim());
      setStep("done");
      onChanged?.(result);
    } catch (err) {
      setError(err?.message || t("settings.security.genericError"));
    } finally {
      setBusy(false);
    }
  };

  if (step === "done") {
    return (
      <div className="p-3 rounded-lg bg-ok/10 text-sm flex items-start gap-2">
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
        <span>{t("settings.security.changedOk", { email: newEmail.trim() })}</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>
      )}
      {step === "form" && (
        <form onSubmit={start} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="change-email-new">{t("settings.security.newEmailLabel")}</Label>
            <Input
              id="change-email-new"
              type="email"
              autoComplete="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="h-11"
              required
            />
          </div>
          {requirePassword && (
            <div className="space-y-2">
              <Label htmlFor="change-email-password">{t("settings.security.currentPasswordLabel")}</Label>
              <Input
                id="change-email-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11"
                required
              />
            </div>
          )}
          <Button type="submit" disabled={busy} className="h-11">
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Mail className="w-4 h-4 mr-2" />}
            {t("settings.security.sendCode")}
          </Button>
        </form>
      )}
      {step === "code" && (
        <form onSubmit={finish} className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t("settings.security.codeSentTo", { email: newEmail.trim() })}
          </p>
          <div className="space-y-2">
            <Label htmlFor="change-email-code">{t("settings.security.codeLabel")}</Label>
            <Input
              id="change-email-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="h-11 tracking-widest"
              required
            />
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy} className="h-11">
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              {t("settings.security.confirmButton")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => { setStep("form"); setCode(""); setError(""); }}
            >
              {t("recovery.startOver")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
