import type { CSSProperties } from 'react';
import { isDark, shiftHue } from '@shared/color';
import { STYLE_PRESETS, type StylePreset } from '@shared/presets';
import type { Theme } from '@shared/schema';
import { fontCss, HEADING_WEIGHTS } from '../../lib/fonts';

const CORNER = { sharp: 2, soft: 5, round: 9 } as const;
const BUTTON_CORNER = { sharp: 2, soft: 4, round: 99 } as const;

/** A preset is "on" when every setting it controls matches the page. */
export const presetIsOn = (theme: Theme, preset: StylePreset): boolean => {
  const made = preset.make(theme.brand) as Record<string, unknown>;
  return Object.keys(made).every((k) => (theme as Record<string, unknown>)[k] === made[k]);
};

/** A miniature of the page in a preset's own type, colours, corners and cards. */
function Thumb({ preset, brand }: { preset: StylePreset; brand: string }) {
  const t = { brand, ...preset.make(brand) };
  const dark = isDark(t.bg);
  const button = t.gradient ? `linear-gradient(135deg,${t.brand},${shiftHue(t.brand, 32)})` : t.brand;
  const card: CSSProperties = {
    borderRadius: CORNER[t.radius],
    background: t.cards === 'flat' ? `color-mix(in srgb, ${t.text} 6%, ${t.alt_bg})` : dark ? 'rgba(255,255,255,.07)' : t.bg,
    border: t.cards === 'outlined' ? `1px solid color-mix(in srgb, ${t.text} 14%, transparent)` : '1px solid transparent',
    boxShadow: t.cards === 'raised' ? '0 4px 8px -3px rgba(0,0,0,.28)' : 'none',
  };
  return (
    <span className="ps-thumb" style={{ background: t.bg, color: t.text }} aria-hidden="true">
      <span className="ps-top">
        <span className="ps-head" style={{ fontFamily: fontCss(t.heading_font ?? t.font), fontWeight: HEADING_WEIGHTS[t.heading_weight] }}>
          Aa
        </span>
        <span className="ps-side">
          <i style={{ background: t.muted }} />
          <i style={{ background: t.muted, width: '70%' }} />
          <b style={{ background: button, borderRadius: BUTTON_CORNER[t.radius] }} />
        </span>
      </span>
      <span className="ps-band" style={{ background: t.alt_bg }}>
        <i style={card} />
        <i style={card} />
        <i style={card} />
      </span>
    </span>
  );
}

/** One-click looks. They change type, colours, corners and spacing, and keep the brand colour. */
export function StyleGallery({ theme, onPick }: { theme: Theme; onPick: (p: StylePreset) => void }) {
  const current = STYLE_PRESETS.find((p) => presetIsOn(theme, p));
  return (
    <>
      <div className="ps-grid" role="group" aria-label="Page styles">
        {STYLE_PRESETS.map((p) => {
          const on = presetIsOn(theme, p);
          return (
            <button key={p.id} type="button" className="ps" aria-pressed={on} title={p.blurb} onClick={() => onPick(p)}>
              <Thumb preset={p} brand={theme.brand} />
              <span className="ps-name">{p.name}</span>
            </button>
          );
        })}
      </div>
      <div className="hint" aria-live="polite">
        {current ? `${current.name}: ${current.blurb}` : 'Customised. Pick a style to start again from one of these.'}
      </div>
    </>
  );
}
