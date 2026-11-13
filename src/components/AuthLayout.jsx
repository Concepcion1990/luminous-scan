import React from "react";
import { t, useLocale } from '@/lib/i18n';
import LanguagePicker from "@/components/LanguagePicker";
import { ScanLine } from "lucide-react";

export default function AuthLayout({ icon: Icon, title, subtitle, footer, below, children }) {
  // The auth pages are public pages: the language picker sits at the
  // top of the column so a visitor can read sign-in / registration in
  // their language before creating an account. The layout subscribes
  // so its own strings (the tagline) re-render on switch; each page
  // subscribes too, for its form strings.
  useLocale();
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-4 flex justify-end">
          <LanguagePicker />
        </div>
        <div className="flex flex-col items-center mb-8">
          <div className="inline-flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <ScanLine className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="font-heading text-sm font-semibold tracking-tight text-foreground">
              Luminous StockHaven
            </span>
          </div>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            {t('auth.tagline')}
          </p>
        </div>
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary mb-4">
            <Icon className="w-7 h-7 text-primary-foreground" aria-hidden="true" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{title}</h1>
          {subtitle && <p className="text-muted-foreground mt-2">{subtitle}</p>}
        </div>
        <div className="bg-card rounded-2xl shadow-sm border border-border p-8">
          {children}
        </div>
        {footer && (
          <p className="text-center text-sm text-muted-foreground mt-6">{footer}</p>
        )}
        {/*
          Optional content below the card, inside the same centered column.
          Only Register passes it today: the trademark notice sits below
          the create-account form — visible while someone is creating
          their account, never blocking the form itself. Other auth pages
          pass nothing and render exactly as before.
        */}
        {below && <div className="mt-6 pb-10">{below}</div>}
      </div>
    </div>
  );
}