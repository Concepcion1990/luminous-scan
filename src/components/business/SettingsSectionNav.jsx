import { useEffect, useRef, useState } from 'react';
import { t, useLocale } from '@/lib/i18n';

/**
 * Settings section navigator (owner's pick, Nov 20, 2026:
 * "Ribbon of chips across the top"). Settings has grown long,
 * so on mobile widths a horizontally scrollable ribbon of
 * chips sits at the top of the page — one chip per section
 * card ON THE VIEWER'S OWN PAGE. The owner's ribbon lists the
 * owner's sections; a member's ribbon lists exactly the
 * sections their personal Settings renders, owner-granted
 * sections included — never a chip for a section that is not
 * there (no doors to nowhere, her standing rule). Tapping a
 * chip smooth-scrolls that section into view, clearing the
 * sticky app header and the ribbon itself, so the section's
 * title is never hidden underneath either.
 *
 * One responsive app, shaped by screen WIDTH, not by device
 * or browser: the ribbon exists only below the lg boundary —
 * the same line the app's own mobile chrome (header, tab bar)
 * uses — so phones and upright tablets get it, in the
 * installed app and in any mobile browser alike, and wider
 * layouts are untouched. Chip labels reuse the sections' own
 * heading strings, so the ribbon speaks every language the
 * page does with no new keys.
 */
function appHeader() {
  return [...document.querySelectorAll('header')].find(
    (el) => el.getBoundingClientRect().height > 0
      && window.getComputedStyle(el).position === 'sticky',
  );
}

export default function SettingsSectionNav({ sections }) {
  useLocale(); // the labels re-render the moment the language changes
  const navRef = useRef(null);
  const [headerHeight, setHeaderHeight] = useState(0);

  // The ribbon pins directly beneath the app shell's sticky
  // header and tracks its height (the header grows when the
  // All screens menu opens inside it).
  useEffect(() => {
    const header = appHeader();
    if (!header) return undefined;
    const update = () => setHeaderHeight(header.getBoundingClientRect().height);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  const scrollToSection = (id) => {
    const target = document.getElementById(id);
    if (!target) return;
    const header = appHeader();
    const offset = (header ? header.getBoundingClientRect().height : 0)
      + (navRef.current ? navRef.current.getBoundingClientRect().height : 0)
      + 10;
    const top = target.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' });
  };

  if (!sections.length) return null;

  return (
    <nav
      ref={navRef}
      aria-label={t('settings.title')}
      className="sticky z-10 bg-background lg:hidden"
      style={{ top: headerHeight }}
    >
      <div className="flex gap-2 overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sections.map(({ id, labelKey }) => (
          <button
            key={id}
            type="button"
            onClick={() => scrollToSection(id)}
            className="min-h-10 shrink-0 whitespace-nowrap rounded-full border border-border bg-card px-3.5 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t(labelKey)}
          </button>
        ))}
      </div>
    </nav>
  );
}
