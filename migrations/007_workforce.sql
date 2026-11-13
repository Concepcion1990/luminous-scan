-- 007_workforce.sql — Workforce phase (scheduling, time clock,
-- time-off, tasks, payroll, cash-up, direct deposit).
--
-- People in workforce are staff_members rows — managers are staff
-- rows whose role is Manager (preset-manager or a role named
-- Manager); the business OWNER is not a staff row and is never
-- scheduled, clocked or paid through here.
--
-- workforce_settings: one row per business. self_clock_enabled is
-- the owner's switch for staff clocking themselves in/out (default
-- ON, the owner's decision Nov 9). dd_enabled turns the direct
-- deposit section on.
--
-- work_schedules: one row per person per weekday (0 = Sunday ..
-- 6 = Saturday, matching the business-local calendar). Times are
-- 'HH:MM' 24h in the BUSINESS timezone; a shift is same-day only
-- (end after start) in this phase.
--
-- time_entries / time_breaks: a shift entry opens at clock-in and
-- closes at clock-out; breaks hang off the open entry. Break time
-- is unpaid (excluded from payroll hours) but stays visible on the
-- entry. unscheduled marks a clock-in on a day with no shift;
-- early_departure + early_note record an emergency early leave.
--
-- workforce_notifications: the real-time push, as records (the
-- cross-store inbox pattern — created at event time, visible on
-- the next fetch; no websocket layer). One row per recipient user.
--
-- pay_profiles: one row per person. pay_type 'hourly' uses
-- hourly_rate; 'salary' uses annual_salary (the owner chooses per
-- person — managers may be either; staff are hourly in practice
-- but the field is not restricted server-side beyond the owner's
-- own choice).
--
-- payroll_config: the owner's tax/deduction settings, entered ONCE
-- and applied to every run: federal/state percentages, Social
-- Security (default 6.2%), Medicare (default 1.45%) and up to five
-- custom deductions as a JSON array in TEXT
-- ([{name, kind: 'percent'|'flat', value}]) — TEXT to match the
-- codebase's JSON-in-TEXT convention (permissions, roles).
--
-- pay_stubs: one row per person per run, generated UNPUSHED; only
-- a pushed stub is visible to its person. deductions is the JSON
-- breakdown in TEXT.
--
-- direct_deposit_details: SENSITIVE. routing/account numbers are
-- only ever returned in full to the business owner (single-row
-- read); every list/masked view shows the last 4 digits only.
-- status 'invited' = the owner asked, no details yet; 'submitted'
-- = the employee sent their details back.

CREATE TABLE IF NOT EXISTS workforce_settings (
  business_id TEXT PRIMARY KEY REFERENCES businesses (id) ON DELETE CASCADE,
  self_clock_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  dd_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS work_schedules (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  staff_member_id TEXT NOT NULL REFERENCES staff_members (id) ON DELETE CASCADE,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  created_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, staff_member_id, weekday)
);
CREATE INDEX IF NOT EXISTS idx_work_schedules_business ON work_schedules (business_id, staff_member_id);

CREATE TABLE IF NOT EXISTS time_entries (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  staff_member_id TEXT NOT NULL REFERENCES staff_members (id) ON DELETE CASCADE,
  clock_in_at TIMESTAMPTZ NOT NULL,
  clock_out_at TIMESTAMPTZ,
  unscheduled BOOLEAN NOT NULL DEFAULT FALSE,
  early_departure BOOLEAN NOT NULL DEFAULT FALSE,
  early_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_time_entries_business ON time_entries (business_id, staff_member_id, clock_in_at DESC);

CREATE TABLE IF NOT EXISTS time_breaks (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES time_entries (id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  break_type TEXT NOT NULL CHECK (break_type IN ('break15', 'lunch30', 'lunch60')),
  planned_minutes INTEGER NOT NULL DEFAULT 15,
  out_at TIMESTAMPTZ NOT NULL,
  in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_time_breaks_entry ON time_breaks (entry_id);

CREATE TABLE IF NOT EXISTS workforce_notifications (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  recipient_user_id TEXT NOT NULL,
  recipient_staff_id TEXT,
  recipient_role TEXT NOT NULL DEFAULT 'owner',
  actor_staff_id TEXT,
  actor_name TEXT NOT NULL DEFAULT '',
  event TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  entry_id TEXT,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wf_notifications_recipient ON workforce_notifications (recipient_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS time_off_requests (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  staff_member_id TEXT NOT NULL REFERENCES staff_members (id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  decision_reason TEXT NOT NULL DEFAULT '',
  decided_by_id TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_time_off_business ON time_off_requests (business_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS work_tasks (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  staff_member_id TEXT NOT NULL REFERENCES staff_members (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  done_at TIMESTAMPTZ,
  created_by_id TEXT,
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_work_tasks_business ON work_tasks (business_id, staff_member_id, status);

CREATE TABLE IF NOT EXISTS pay_profiles (
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  staff_member_id TEXT NOT NULL REFERENCES staff_members (id) ON DELETE CASCADE,
  pay_type TEXT NOT NULL DEFAULT 'hourly' CHECK (pay_type IN ('hourly', 'salary')),
  hourly_rate NUMERIC NOT NULL DEFAULT 0,
  annual_salary NUMERIC NOT NULL DEFAULT 0,
  updated_by_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (business_id, staff_member_id)
);

CREATE TABLE IF NOT EXISTS payroll_config (
  business_id TEXT PRIMARY KEY REFERENCES businesses (id) ON DELETE CASCADE,
  federal_pct NUMERIC NOT NULL DEFAULT 0,
  state_pct NUMERIC NOT NULL DEFAULT 0,
  social_security_pct NUMERIC NOT NULL DEFAULT 6.2,
  medicare_pct NUMERIC NOT NULL DEFAULT 1.45,
  custom_deductions TEXT NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  created_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_business ON payroll_runs (business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pay_stubs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES payroll_runs (id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  staff_member_id TEXT NOT NULL REFERENCES staff_members (id) ON DELETE CASCADE,
  person_name TEXT NOT NULL DEFAULT '',
  pay_type TEXT NOT NULL DEFAULT 'hourly',
  regular_hours NUMERIC NOT NULL DEFAULT 0,
  overtime_hours NUMERIC NOT NULL DEFAULT 0,
  gross NUMERIC NOT NULL DEFAULT 0,
  bonus NUMERIC NOT NULL DEFAULT 0,
  tips NUMERIC NOT NULL DEFAULT 0,
  deductions TEXT NOT NULL DEFAULT '[]',
  total_deductions NUMERIC NOT NULL DEFAULT 0,
  net NUMERIC NOT NULL DEFAULT 0,
  pushed BOOLEAN NOT NULL DEFAULT FALSE,
  pushed_by_id TEXT,
  pushed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pay_stubs_business ON pay_stubs (business_id, staff_member_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cash_ups (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  date DATE NOT NULL,
  float_amount NUMERIC NOT NULL DEFAULT 0,
  cash_sales NUMERIC NOT NULL DEFAULT 0,
  cash_refunds NUMERIC NOT NULL DEFAULT 0,
  payouts NUMERIC NOT NULL DEFAULT 0,
  card_payments NUMERIC NOT NULL DEFAULT 0,
  denominations TEXT NOT NULL DEFAULT '{}',
  counted_total NUMERIC NOT NULL DEFAULT 0,
  expected_total NUMERIC NOT NULL DEFAULT 0,
  over_short NUMERIC NOT NULL DEFAULT 0,
  counted_by_id TEXT,
  counted_by_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cash_ups_business ON cash_ups (business_id, date DESC);

CREATE TABLE IF NOT EXISTS direct_deposit_details (
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  staff_member_id TEXT NOT NULL REFERENCES staff_members (id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'submitted')),
  bank_name TEXT NOT NULL DEFAULT '',
  account_type TEXT NOT NULL DEFAULT 'checking' CHECK (account_type IN ('checking', 'savings')),
  routing_number TEXT NOT NULL DEFAULT '',
  account_number TEXT NOT NULL DEFAULT '',
  requested_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (business_id, staff_member_id)
);
