/**
 * Rewards & incentives, client side (Rewards phase).
 *
 * Thin wrappers over /api/businesses/:bid/workforce/rewards/* —
 * every rule (Business-only plan gate, who may give to whom, who
 * sees what, void hierarchy) is decided on the server; this file
 * only carries calls plus the reward-slip text builder.
 *
 * The slip is the shareable/printable form of a reward. White-label
 * rule: it carries ONLY the business's own name — never the app's
 * name — and the tests search it for app branding.
 *
 * (Node-testable shape: the API client is imported by relative
 * path, not the `@/` alias — same note as src/lib/workforce.js.
 * The slip builder itself is pure.)
 */
import { apiRequest } from '../api/client.js';
import { t } from './i18n.js';

const base = (businessId) => `/api/businesses/${encodeURIComponent(businessId)}/workforce/rewards`;

export function listRewards(businessId) {
  return apiRequest(base(businessId));
}

export function createReward(businessId, values) {
  return apiRequest(base(businessId), { method: 'POST', body: values });
}

export function redeemReward(businessId, code) {
  return apiRequest(`${base(businessId)}/redeem`, { method: 'POST', body: { code } });
}

export function voidReward(businessId, id) {
  return apiRequest(`${base(businessId)}/${encodeURIComponent(id)}/void`, { method: 'POST', body: {} });
}

// ---- Labels --------------------------------------------------------------

export function rewardKindLabel(kind) {
  switch (kind) {
    case 'gift_card':
      return t('rewards.kind.giftCard');
    case 'custom':
      return t('rewards.kind.custom');
    default:
      return t('rewards.kind.percentOff');
  }
}

export function rewardStatusLabel(status) {
  switch (status) {
    case 'redeemed':
      return t('rewards.status.redeemed');
    case 'void':
      return t('rewards.status.void');
    default:
      return t('rewards.status.active');
  }
}

/** The reward's value in one short line, in the giver's terms. */
export function rewardValueText(reward) {
  if (!reward) return '';
  if (reward.kind === 'percent_off') {
    return t('rewards.value.percentOff', { percent: reward.percent_value ?? '' });
  }
  if (reward.kind === 'gift_card') {
    const amount = Number(reward.amount || 0).toFixed(2);
    return t('rewards.value.giftCard', { value: `${reward.currency || 'USD'} ${amount}` });
  }
  return reward.detail || '';
}

// ---- The slip --------------------------------------------------------------

/**
 * The printable/shareable reward slip as plain text. ONLY the
 * business's own name appears as a brand — the app's name is never
 * on it. Labels are injectable so the page can pass translated
 * strings; the defaults are the English wording.
 */
export function buildRewardSlipText(businessName, reward, labels = {}) {
  const forLabel = labels.forLabel ?? 'For';
  const codeLabel = labels.codeLabel ?? 'Code';
  const showLine = labels.showLine ?? 'Show this code at the till.';
  const valueLine = labels.valueLine ?? '';
  const lines = [
    String(businessName || ''),
    '',
    reward.title,
    valueLine,
  ];
  if (reward.description) lines.push(reward.description);
  lines.push(
    `${forLabel}: ${reward.recipient_name || ''}`,
    `${codeLabel}: ${reward.code}`,
    showLine,
  );
  return lines.join('\n');
}
