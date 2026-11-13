import React, { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, KeyRound, Loader2, MailCheck, Printer, ShieldCheck } from "lucide-react";
import SettingsCard from "@/components/business/SettingsCard";
import ChangeEmailForm from "@/components/ChangeEmailForm";
import { t } from "@/lib/i18n";
import {
  getSecurityStatus,
  generateBackupCodes,
  startBackupEmail,
  verifyBackupEmail,
} from "@/lib/recovery";

/**
 * Settings → Security: the spare keys, set up while safely signed in
 * so a lost email never costs anyone their shop (the owner's own
 * lived experience, and her standing requirement).
 *
 *   - Backup codes: one-time keys, shown ONCE at generation; the
 *     server keeps only hashes and reports how many remain.
 *   - Backup email: a second address, proven by a 6-digit code,
 *     that can receive a recovery code later.
 *   - Change email: the normal path into the same machinery the
 *     recovery page graduates through.
 *
 * Phone/SMS is deliberately absent: no SMS provider exists yet, and
 * a dead control would be worse than an honest gap.
 */
export default function SecurityCard() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [freshCodes, setFreshCodes] = useState(null);
  const [backupEmail, setBackupEmailInput] = useState("");
  const [backupCode, setBackupCode] = useState("");
  const [backupStep, setBackupStep] = useState("idle"); // idle -> code

  const load = useCallback(async () => {
    try {
      const next = await getSecurityStatus();
      setStatus(next);
      if (next.backup_email_pending) setBackupStep("code");
    } catch (err) {
      setError(err?.message || t("settings.security.genericError"));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async (key, fn) => {
    setError("");
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      setError(err?.message || t("settings.security.genericError"));
    } finally {
      setBusy("");
    }
  };

  const onGenerateCodes = () => run("codes", async () => {
    const result = await generateBackupCodes();
    setFreshCodes(result.codes || []);
    await load();
  });

  const onStartBackupEmail = () => run("backup-start", async () => {
    await startBackupEmail(backupEmail.trim());
    setBackupStep("code");
    await load();
  });

  const onVerifyBackupEmail = () => run("backup-verify", async () => {
    await verifyBackupEmail(backupCode.trim());
    setBackupStep("idle");
    setBackupCode("");
    await load();
  });

  return (
    <SettingsCard title={t("settings.security.title")} description={t("settings.security.description")}>
      {error && (
        <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>
      )}

      <div className="flex items-center gap-2 text-sm">
        <ShieldCheck className="h-4 w-4 text-muted-foreground" />
        <span className="text-muted-foreground">{t("settings.security.accountEmail")}</span>
        <span className="font-medium">{status?.email || "…"}</span>
      </div>

      <div className="border-t border-border pt-5 space-y-3">
        <div>
          <h3 className="text-sm font-medium flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> {t("settings.security.backupCodesTitle")}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">{t("settings.security.backupCodesDesc")}</p>
        </div>
        {status && (
          <p className="text-sm">{t("settings.security.codesRemaining", { count: status.backup_codes_remaining })}</p>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={busy === "codes"}
          onClick={onGenerateCodes}
          className="h-11"
        >
          {busy === "codes" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          {status && status.backup_codes_remaining > 0
            ? t("settings.security.regenerateCodes")
            : t("settings.security.generateCodes")}
        </Button>
        {freshCodes && (
          <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-4">
            <p className="text-sm font-medium">{t("settings.security.newCodesTitle")}</p>
            <div className="grid grid-cols-2 gap-2 font-mono text-sm tracking-widest">
              {freshCodes.map((code) => (
                <span key={code} className="rounded bg-background px-2 py-1 text-center">{code}</span>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t("settings.security.codesOnceWarning")}</p>
            <Button type="button" variant="ghost" size="sm" onClick={() => window.print()}>
              <Printer className="w-4 h-4 mr-2" />
              {t("settings.security.printCodes")}
            </Button>
          </div>
        )}
      </div>

      <div className="border-t border-border pt-5 space-y-3">
        <div>
          <h3 className="text-sm font-medium flex items-center gap-2">
            <MailCheck className="h-4 w-4" /> {t("settings.security.backupEmailTitle")}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">{t("settings.security.backupEmailDesc")}</p>
        </div>
        {status?.backup_email_verified ? (
          <p className="text-sm flex items-center gap-2">
            <Check className="h-4 w-4 text-ok" />
            {t("settings.security.backupEmailVerified", { email: status.backup_email })}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t("settings.security.backupEmailNone")}</p>
        )}
        {backupStep === "idle" && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-2 flex-1 min-w-52">
              <Label htmlFor="security-backup-email">{t("settings.security.backupEmailLabel")}</Label>
              <Input
                id="security-backup-email"
                type="email"
                autoComplete="email"
                value={backupEmail}
                onChange={(e) => setBackupEmailInput(e.target.value)}
                className="h-11"
              />
            </div>
            <Button type="button" disabled={busy === "backup-start" || !backupEmail.trim()} onClick={onStartBackupEmail} className="h-11">
              {busy === "backup-start" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              {t("settings.security.backupEmailSave")}
            </Button>
          </div>
        )}
        {backupStep === "code" && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{t("settings.security.backupEmailPending")}</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-2">
                <Label htmlFor="security-backup-code">{t("settings.security.verifyCodeLabel")}</Label>
                <Input
                  id="security-backup-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={backupCode}
                  onChange={(e) => setBackupCode(e.target.value)}
                  className="h-11 tracking-widest"
                />
              </div>
              <Button type="button" disabled={busy === "backup-verify" || !backupCode.trim()} onClick={onVerifyBackupEmail} className="h-11">
                {busy === "backup-verify" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                {t("settings.security.verifyButton")}
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-border pt-5 space-y-3">
        <div>
          <h3 className="text-sm font-medium">{t("settings.security.changeEmailTitle")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{t("settings.security.changeEmailDesc")}</p>
        </div>
        <ChangeEmailForm requirePassword onChanged={load} />
      </div>
    </SettingsCard>
  );
}
