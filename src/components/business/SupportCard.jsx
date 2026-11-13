import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Check, Loader2, MessageSquareWarning } from "lucide-react";
import SettingsCard from "@/components/business/SettingsCard";
import { t, getLocale } from "@/lib/i18n";
import { submitProblemReport } from "@/lib/support";

const CATEGORIES = [
  { key: "broken", labelKey: "support.category.broken" },
  { key: "looks_wrong", labelKey: "support.category.looksWrong" },
  { key: "idea", labelKey: "support.category.idea" },
  { key: "other", labelKey: "support.category.other" },
];

const MESSAGE_MIN = 3;
const MESSAGE_MAX = 2000;

/** Server error code -> the card's own localized line. */
function errorLine(err) {
  const code = err?.data?.error;
  if (code === "support_rate_limited") return t("support.errorRateLimit");
  if (code === "support_message_too_long") return t("support.errorTooLong");
  if (code === "support_message_required" || code === "support_message_too_short") {
    return t("support.errorTooShort");
  }
  return t("support.errorGeneric");
}

/**
 * Settings → Report a problem: the owner's support door (her idea,
 * Nov 13, 2026) — the same report-and-fix loop she runs with her
 * builder, opened to every signed-in user on every plan, staff
 * included, because staff hit bugs first at the till.
 *
 * The form is deliberately short: a category and the person's own
 * words. The transparency line says plainly what the app attaches
 * automatically (the page, the selected business and role, the
 * plan, the language, the device kind — never products, stock or
 * sales); the server attaches those from its own records, so
 * nothing here can be dressed up by the client. The saved report
 * is the record; a copy is emailed to the support inbox.
 */
export default function SupportCard() {
  const [category, setCategory] = useState("broken");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  // The page the user was on when the form opened — captured once,
  // at open, not at submit (the wording the report promises).
  const pageAtOpen = useRef(
    typeof window !== "undefined" ? window.location.pathname : ""
  );

  const submit = async () => {
    const trimmed = message.trim();
    if (trimmed.length < MESSAGE_MIN) {
      setError(t("support.errorTooShort"));
      return;
    }
    if (trimmed.length > MESSAGE_MAX) {
      setError(t("support.errorTooLong"));
      return;
    }
    setError("");
    setBusy(true);
    try {
      await submitProblemReport({
        category,
        message: trimmed,
        page: pageAtOpen.current,
        locale: getLocale(),
      });
      setSent(true);
    } catch (err) {
      setError(errorLine(err));
    } finally {
      setBusy(false);
    }
  };

  const sendAnother = () => {
    setSent(false);
    setMessage("");
    setError("");
  };

  return (
    <SettingsCard title={t("support.title")} description={t("support.description")}>
      {error && (
        <div role="alert" className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>
      )}

      {sent ? (
        <div role="status" className="space-y-3 rounded-lg border border-border bg-muted/40 p-4">
          <p className="text-sm font-medium flex items-center gap-2">
            <Check className="h-4 w-4 text-ok" />
            {t("support.sentTitle")}
          </p>
          <p className="text-sm text-muted-foreground">{t("support.sentBody")}</p>
          <Button type="button" variant="outline" onClick={sendAnother} className="h-11">
            {t("support.sendAnother")}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="support-category">{t("support.categoryLabel")}</Label>
            <select
              id="support-category"
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={busy}
            >
              {CATEGORIES.map(({ key, labelKey }) => (
                <option key={key} value={key}>{t(labelKey)}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="support-message">{t("support.messageLabel")}</Label>
            <Textarea
              id="support-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("support.messagePlaceholder")}
              maxLength={MESSAGE_MAX + 100}
              rows={5}
              disabled={busy}
            />
          </div>

          <p className="text-xs leading-relaxed text-muted-foreground">{t("support.contextNote")}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{t("support.urgentNote")}</p>

          <Button type="button" onClick={submit} disabled={busy} className="h-11">
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <MessageSquareWarning className="w-4 h-4 mr-2" />}
            {busy ? t("support.sending") : t("support.submit")}
          </Button>
        </div>
      )}
    </SettingsCard>
  );
}
