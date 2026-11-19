-- 029_staff_auto_logout.sql — the shift-window bracket (owner
-- ruling, Nov 19, 2026). A non-owner member's access is bracketed
-- by the schedule posted for them: sign-in opens 10 minutes before
-- the scheduled shift, and clocking out starts a 10-minute grace
-- window after which the app signs them out on its own.
--
-- auto_logout_at: the moment the current grace window ends. Set by
-- the clock-out handler (clock-out + 10 minutes), cleared by the
-- clock-in handler (clocking back in cancels the pending
-- auto-logout). NULL means no grace window is running. The deadline
-- lives on the member's row in THIS business, so the same person's
-- sessions in a business they own are never touched by it.
ALTER TABLE staff_members ADD COLUMN auto_logout_at TIMESTAMPTZ NULL;

-- welcome_seen_at: the one-time staff welcome page (owner's
-- addition, Nov 19, 2026). NULL = the welcome has not been shown
-- yet; the first sign-in that lands sets it (server-side, per
-- member row, so it never reappears — including on another
-- device). The mechanism is role-aware but enabled for staff
-- only; the manager case awaits the owner's ruling.
ALTER TABLE staff_members ADD COLUMN welcome_seen_at TIMESTAMPTZ NULL;

-- staff_welcome_script: the owner's own welcome words for their
-- store (owner refinement, Nov 19, 2026). The owner rewrites the
-- script from the Staff area; {name} and {store} auto-fill for
-- each new hire. '' (the default) means "use the app's standard
-- welcome" — an empty save brings the standard text back, so a
-- hire never lands on a blank page. The "Welcome to Luminous
-- StockHaven" line is NOT in this script: it is permanent app
-- copy, rendered outside the editable text.
ALTER TABLE businesses ADD COLUMN staff_welcome_script TEXT NOT NULL DEFAULT '';
