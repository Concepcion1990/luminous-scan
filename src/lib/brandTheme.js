/**
 * Brand theme — T6 (the owed Settings color-picker check).
 *
 * FINDING: the picker in Settings (IdentityCard) saved `brand_color`
 * on the business record, but NOTHING ever read it — no code applied
 * the color to the app. The picker was decoration. This module is the
 * fix: it turns the saved hex color into the theme variables the app
 * actually uses (`--primary`, `--ring`, sidebar colors) and applies
 * them through one `<style>` tag in the document head, with both the
 * light and the dark values — so dark mode keeps working (an inline
 * style would have flattened the dark theme).
 *
 * The app name stays Luminous StockHaven, top and bottom, whatever
 * the brand color is — the color only re-skins the store's own chrome.
 */

/**
 * The DEFAULT brand color — the approved Luminous cream-tan #E3D5BF —
 * is what a workspace wears when the business has NOT chosen its own
 * branding. It is not an override: #E3D5BF is the exact tone the
 * stylesheet's approved theme (src/index.css) already pins as
 * --primary on every surface, so a business with no branding simply
 * gets the app's own cream theme — warm cream band, charcoal ink
 * text, tan pills — the look of the original app and of the public
 * pages. brandThemeVars therefore returns null for the default and
 * applying it CLEARS any override tag: no custom color, no re-skin.
 *
 * Two retired defaults sit behind this one. #145042, a deep teal no
 * business ever picked, was stamped silently onto new workspaces and
 * re-skinned the whole signed-in shell teal — bright mint in dark
 * mode (the owner's catch, Nov 14, 2026: "I shouldn't be seeing that
 * color"). A deep bronze #6d4c26 replaced it for a few hours the same
 * day, but run through the derivation below it painted a solid brown
 * band and brown buttons, and the owner rejected that too: the
 * default should look like the original app in her Base44
 * screenshots — cream, not a saturated band of anything.
 * resolveBrandColor treats the teal hex as "unset" wherever a
 * default is applied, so workspaces that never chose a color land on
 * the cream default. Any color a business actually chose — the
 * picker presets, a custom hex, any hue at all — passes through
 * untouched and renders exactly as chosen: the white-label freedom
 * is the feature, and this default only fills the silence.
 */
export const DEFAULT_BRAND_COLOR = '#e3d5bf';
export const LEGACY_DEFAULT_BRAND_COLOR = '#145042';

/** The brand color to render: the business's own choice, or the default. */
export function resolveBrandColor(hex) {
  const value = String(hex || '').trim().toLowerCase();
  if (!value || value === LEGACY_DEFAULT_BRAND_COLOR) return DEFAULT_BRAND_COLOR;
  return value;
}

export function hexToHsl(hex) {
  const match = /^#([0-9a-fA-F]{6})$/.exec(String(hex || '').trim());
  if (!match) return null;
  const n = Number.parseInt(match[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: Math.round(h * 60), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/**
 * The theme variables for one brand color. Light values come from the
 * color as saved; dark values lift the lightness so the same hue
 * reads on a dark background. `null` when the color is not a hex
 * color — and for the default cream-tan, whose theme is the
 * stylesheet itself (see DEFAULT_BRAND_COLOR above): a single hex
 * run through this derivation can only ever produce a saturated
 * band, which is exactly how both retired defaults went wrong.
 */
export function brandThemeVars(hex) {
  if (String(hex || '').trim().toLowerCase() === DEFAULT_BRAND_COLOR) return null;
  const hsl = hexToHsl(hex);
  if (!hsl) return null;
  const { h, s, l } = hsl;
  const lightL = Math.min(Math.max(l, 12), 45);
  const darkL = Math.min(Math.max(l + 25, 45), 70);
  return {
    light: {
      '--primary': `${h} ${s}% ${lightL}%`,
      '--ring': `${h} ${s}% ${lightL}%`,
      '--sidebar-background': `${h} ${Math.min(s, 60)}% ${Math.max(lightL - 4, 8)}%`,
      '--sidebar-accent': `${h} ${Math.min(s, 55)}% ${Math.min(lightL + 12, 40)}%`,
      '--sidebar-border': `${h} ${Math.min(s, 45)}% ${Math.min(lightL + 14, 45)}%`,
    },
    dark: {
      '--primary': `${h} ${s}% ${darkL}%`,
      '--ring': `${h} ${s}% ${darkL}%`,
      '--sidebar-background': `${h} ${Math.min(s, 50)}% 9%`,
      '--sidebar-accent': `${h} ${Math.min(s, 50)}% ${Math.min(lightL + 10, 35)}%`,
      '--sidebar-border': `${h} ${Math.min(s, 40)}% 22%`,
    },
  };
}

function varsBlock(selector, vars) {
  return `${selector}{${Object.entries(vars).map(([k, v]) => `${k}:${v};`).join('')}}`;
}

/**
 * The full stylesheet text for one brand color. Empty when the color
 * is invalid — and for the default cream-tan, whose theme is the
 * stylesheet itself, so applying the default removes the override
 * tag and the app's approved cream theme rules every surface.
 */
export function brandThemeCss(hex) {
  const vars = brandThemeVars(hex);
  if (!vars) return '';
  return `${varsBlock(':root', vars.light)}${varsBlock('.dark', vars.dark)}`;
}

function findBrandStyleTag(doc) {
  if (!doc?.querySelector) return null;
  return doc.querySelector('style[data-brand-theme]');
}

/**
 * Apply a brand color to the document. Writes (or refreshes) one
 * `<style data-brand-theme>` tag in `<head>`; an invalid color
 * removes the tag, back to the stylesheet defaults. Returns true
 * when a color was applied, false when cleared or when there is no
 * document (server-side render / tests without a DOM).
 */
export function applyBrandColor(hex, doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return false;
  const css = brandThemeCss(hex);
  let tag = findBrandStyleTag(doc);
  if (!css) {
    if (tag?.remove) tag.remove();
    return false;
  }
  if (!tag) {
    if (typeof doc.createElement !== 'function' || !doc.head?.appendChild) return false;
    tag = doc.createElement('style');
    tag.setAttribute('data-brand-theme', '');
    doc.head.appendChild(tag);
  }
  tag.textContent = css;
  return true;
}

/** Remove any brand-color overrides (back to the stylesheet defaults). */
export function clearBrandColor(doc = typeof document !== 'undefined' ? document : null) {
  return applyBrandColor('', doc);
}
