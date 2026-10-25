/** Settings and Customize screens. Both save straight away and go back where they came from. */
import type { PieceKind, Settings, Side } from '../../contracts/types';
import { ANIMAL_NAME, SIDE_NAME } from '../config';
import type { UiCtx, View } from '../ctx';
import { button, h, radioGroup, slider, toggle } from '../dom';
import { NATURAL, animalIcon } from '../icons';
import { defaultSettings } from '../settings';

function panel(title: string, id: string, ctx: UiCtx, ...body: (HTMLElement | null)[]): { el: HTMLElement; back: HTMLButtonElement } {
  const back = button('', { variant: 'icon', sfx: 'back', label: 'Back', icon: '←', onClick: () => ctx.back() });
  const el = h('section', { class: 'mc-screen mc-menu', role: 'dialog', 'aria-labelledby': id },
    h('div', { class: 'mc-panel' },
      h('header', { class: 'mc-panel__head' }, back, h('h2', { id, text: title })),
      h('div', { class: 'mc-panel__body' }, ...body),
      h('footer', { class: 'mc-panel__foot' }, button('Done', { variant: 'primary', sfx: 'back', onClick: () => ctx.back() }))));
  return { el, back };
}

export function settingsScreen(ctx: UiCtx): View {
  const s = ctx.settings;
  const music = slider('Music', s.musicVolume, (v) => ctx.updateSettings({ musicVolume: v }));
  const sfx = slider('Sound effects', s.sfxVolume, (v) => ctx.updateSettings({ sfxVolume: v }), () => ctx.audio.play('select'));
  const quality = radioGroup<Settings['quality']>('Graphics quality', [
    { value: 'auto', label: 'Auto' },
    { value: 'high', label: 'High' },
    { value: 'low', label: 'Low', sub: 'Smoother on phones' },
  ], s.quality, (v) => ctx.updateSettings({ quality: v }));
  const motion = toggle('Reduce motion', s.reducedMotion, (v) => ctx.updateSettings({ reducedMotion: v }), 'Shorter moves, no camera shake.');
  const coords = toggle('Board coordinates', s.showCoordinates, (v) => ctx.updateSettings({ showCoordinates: v }), 'Show a–h and 1–8 on the board edge.');
  const reset = button('Reset to defaults', { variant: 'ghost', class: 'mc-btn--sm', onClick: () => {
    const d = defaultSettings(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
    ctx.updateSettings({ musicVolume: d.musicVolume, sfxVolume: d.sfxVolume, quality: d.quality, reducedMotion: d.reducedMotion, showCoordinates: d.showCoordinates });
    sync();
  } });

  const { el, back } = panel('Settings', 'mc-settings-h', ctx,
    h('h3', { class: 'mc-label', text: 'Sound' }), music.el, sfx.el,
    h('h3', { class: 'mc-label', text: 'Graphics' }), quality.el,
    motion.el, coords.el,
    h('div', { class: 'mc-panel__aside' }, reset));

  function sync() {
    const c = ctx.settings;
    music.set(c.musicVolume);
    sfx.set(c.sfxVolume);
    quality.set(c.quality);
    motion.set(c.reducedMotion);
    coords.set(c.showCoordinates);
  }
  return { el, onShow: sync, focusTarget: () => back };
}

/** Simple colour mix for the swatch preview. */
function mix(a: string, b: string, t: number): string {
  const p = (x: string) => parseInt(x.slice(1), 16);
  const [x, y] = [p(a), p(b)];
  const ch = (s: number) => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t);
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}

const ACCESSORY_ICON: Record<string, string> = {
  'party-hat': '🎉', sunglasses: '🕶️', 'bow-tie': '🎀', 'flower-crown': '🌼', 'pirate-hat': '🏴‍☠️', 'top-hat': '🎩',
};
const KINDS: PieceKind[] = ['k', 'q', 'r', 'b', 'n', 'p'];

export function customizeScreen(ctx: UiCtx): View {
  let side: Side = 'land';
  const preview = h('div', { class: 'mc-preview', 'aria-hidden': 'true' });
  const paletteSlot = h('div');
  const accessorySlot = h('div');
  const note = h('p', { class: 'mc-row__hint mc-preview__note', text: 'Rough preview. The real look shows on the board.' });

  const tabs = radioGroup<Side>('Team', [
    { value: 'land', label: 'Land', html: animalIcon('land', 'k', { disc: true }) },
    { value: 'sea', label: 'Sea', html: animalIcon('sea', 'k', { disc: true }) },
  ], side, (v) => { side = v; render(); }, 'mc-seg mc-seg--tabs');

  const key = () => (side === 'land' ? 'landSkin' : 'seaSkin') as 'landSkin' | 'seaSkin';

  function render() {
    const cat = ctx.skins(side);
    const skin = ctx.settings[key()];
    const palette = skin.palette ?? cat.palettes[0]?.id;
    const accessory = skin.accessory ?? 'none';
    const pal = cat.palettes.find((p) => p.id === palette);
    // The first palette is the natural look; others tint each animal toward the swatch.
    const tint = (k: PieceKind) => (!pal || pal === cat.palettes[0] ? undefined : mix(NATURAL[side][k], pal.swatch, 0.6));
    preview.replaceChildren(...KINDS.map((k) => h('span', { class: 'mc-preview__piece', title: ANIMAL_NAME[side][k], html: animalIcon(side, k, { disc: true, tint: tint(k) }) })));
    const acc = ACCESSORY_ICON[accessory];
    if (acc) preview.append(h('span', { class: 'mc-preview__acc', text: acc }));

    const pg = radioGroup<string>(`${SIDE_NAME[side]} palette`,
      cat.palettes.map((p) => ({ value: p.id, label: p.name, html: `<span class="mc-swatch" style="--sw:${p.swatch}"></span>` })),
      palette ?? '', (v) => { ctx.updateSettings({ [key()]: { ...ctx.settings[key()], palette: v } }); render(); focusIn(paletteSlot); }, 'mc-swatches');
    paletteSlot.replaceChildren(h('h3', { class: 'mc-label', text: 'Palette' }), pg.el);

    const ag = radioGroup<string>(`${SIDE_NAME[side]} accessory`,
      [{ value: 'none', label: 'None', html: '✖️' }, ...cat.accessories.map((a) => ({ value: a.id, label: a.name, html: ACCESSORY_ICON[a.id] ?? '✨' }))],
      accessory, (v) => { ctx.updateSettings({ [key()]: { ...ctx.settings[key()], accessory: v === 'none' ? undefined : v } }); render(); focusIn(accessorySlot); }, 'mc-chips mc-chips--acc');
    accessorySlot.replaceChildren(h('h3', { class: 'mc-label', text: 'Accessory' }), ag.el);
  }
  // Re-rendering replaces the buttons, so put focus back on the checked one.
  const focusIn = (slot: HTMLElement) => slot.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();

  const { el, back } = panel('Customize', 'mc-custom-h', ctx, tabs.el, preview, note, paletteSlot, accessorySlot);
  return { el, onShow: render, focusTarget: () => back };
}
