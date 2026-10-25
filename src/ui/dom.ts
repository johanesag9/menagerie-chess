/** Tiny DOM helpers: no framework, just enough to keep the screens readable. */

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

export type Sfx = 'click' | 'back' | 'none';

export interface ButtonOpts {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon' | 'sea';
  sfx?: Sfx;
  icon?: string;
  label?: string;
  title?: string;
  class?: string;
  onClick?: (e: MouseEvent) => void;
}

/** Chunky pill button. `data-sfx` tells the root listener which sound to play. */
export function button(text: string, o: ButtonOpts = {}): HTMLButtonElement {
  const b = h('button', {
    type: 'button',
    class: `mc-btn mc-btn--${o.variant ?? 'secondary'}${o.class ? ' ' + o.class : ''}`,
    'data-sfx': o.sfx ?? 'click',
    'aria-label': o.label,
    title: o.title,
    onclick: o.onClick,
  });
  if (o.icon) b.append(h('span', { class: 'mc-btn__icon', 'aria-hidden': 'true', html: o.icon }));
  if (text) b.append(h('span', { class: 'mc-btn__text', text }));
  return b;
}

export interface Choice<T extends string | number> {
  value: T;
  label: string;
  sub?: string;
  html?: string;
}

/**
 * A radio group made of buttons (segmented control / chip grid).
 * Arrow keys move the choice, like a native radio group.
 */
export function radioGroup<T extends string | number>(
  name: string,
  choices: Choice<T>[],
  value: T,
  onChange: (v: T) => void,
  cls = 'mc-seg',
): { el: HTMLElement; set(v: T): void; get(): T } {
  let current = value;
  const el = h('div', { class: cls, role: 'radiogroup', 'aria-label': name });
  const btns = choices.map((c) => {
    const b = h('button', { type: 'button', role: 'radio', class: `${cls}__opt`, 'data-sfx': 'click', 'data-value': String(c.value) });
    if (c.html) b.append(h('span', { class: `${cls}__art`, 'aria-hidden': 'true', html: c.html }));
    b.append(h('span', { class: `${cls}__label`, text: c.label }));
    if (c.sub) b.append(h('span', { class: `${cls}__sub`, text: c.sub }));
    b.addEventListener('click', () => {
      if (current === c.value) return;
      set(c.value);
      onChange(c.value);
    });
    return b;
  });
  el.append(...btns);
  el.addEventListener('keydown', (e) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    const i = choices.findIndex((c) => c.value === current);
    const next = choices[(i + keys[e.key] + choices.length) % choices.length];
    set(next.value);
    onChange(next.value);
    btns[choices.indexOf(next)].focus();
  });
  function set(v: T) {
    current = v;
    btns.forEach((b, i) => {
      const on = choices[i].value === v;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
  }
  set(value);
  return { el, set, get: () => current };
}

/** On/off switch with a label and optional hint line. */
export function toggle(label: string, value: boolean, onChange: (v: boolean) => void, hint?: string): { el: HTMLElement; set(v: boolean): void } {
  const id = `mc-${Math.random().toString(36).slice(2, 8)}`;
  const sw = h('button', { type: 'button', role: 'switch', class: 'mc-switch', 'data-sfx': 'click', 'aria-labelledby': `${id}-l`, 'aria-describedby': hint ? `${id}-h` : undefined },
    h('span', { class: 'mc-switch__knob' }));
  const set = (v: boolean) => sw.setAttribute('aria-checked', String(v));
  sw.addEventListener('click', () => {
    const v = sw.getAttribute('aria-checked') !== 'true';
    set(v);
    onChange(v);
  });
  set(value);
  const el = h('div', { class: 'mc-row' },
    h('div', { class: 'mc-row__text' },
      h('span', { class: 'mc-row__label', id: `${id}-l`, text: label }),
      hint ? h('span', { class: 'mc-row__hint', id: `${id}-h`, text: hint }) : null),
    sw);
  return { el, set };
}

/** Labelled 0..1 range slider. `onCommit` fires on release (for a sample sound). */
export function slider(label: string, value: number, onChange: (v: number) => void, onCommit?: () => void): { el: HTMLElement; set(v: number): void } {
  const id = `mc-${Math.random().toString(36).slice(2, 8)}`;
  const out = h('output', { class: 'mc-slider__value', for: id });
  const input = h('input', { type: 'range', id, min: '0', max: '100', step: '1', class: 'mc-slider' });
  const paint = () => {
    out.textContent = `${input.value}%`;
    input.style.setProperty('--fill', `${input.value}%`);
  };
  const set = (v: number) => {
    input.value = String(Math.round(v * 100));
    paint();
  };
  input.addEventListener('input', () => {
    paint();
    onChange(Number(input.value) / 100);
  });
  input.addEventListener('change', () => onCommit?.());
  set(value);
  const el = h('div', { class: 'mc-row mc-row--slider' },
    h('label', { class: 'mc-row__label', for: id, text: label }), input, out);
  return { el, set };
}

/** All focusable children, for focus traps. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])'))
    .filter((el) => el.tabIndex >= 0 && !el.hasAttribute('disabled') && el.offsetParent !== null);
}
