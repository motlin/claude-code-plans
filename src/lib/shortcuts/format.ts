export interface KeyLabel {
  label: string;
  /** Screen-reader text, present only when the label is a glyph. */
  spoken?: string;
}

type Modifier = "ctrl" | "alt" | "shift" | "cmd";

const MODIFIER_ORDER: readonly Modifier[] = ["ctrl", "alt", "shift", "cmd"];

const MODIFIER_ALIASES: Readonly<Record<string, Modifier>> = {
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  option: "alt",
  shift: "shift",
  cmd: "cmd",
  command: "cmd",
  meta: "cmd",
};

const MAC_MODIFIER_LABELS = {
  ctrl: { label: "⌃", spoken: "Control" },
  alt: { label: "⌥", spoken: "Option" },
  shift: { label: "⇧", spoken: "Shift" },
  cmd: { label: "⌘", spoken: "Command" },
} as const satisfies Record<Modifier, KeyLabel>;

const NON_MAC_MODIFIER_LABELS = {
  ctrl: { label: "Ctrl" },
  alt: { label: "Alt" },
  shift: { label: "Shift" },
  cmd: { label: "Ctrl" },
} as const satisfies Record<Modifier, KeyLabel>;

const ARIA_MODIFIER_NAMES = {
  ctrl: "Control",
  alt: "Alt",
  shift: "Shift",
  cmd: "Meta",
} as const satisfies Record<Modifier, string>;

interface NamedKey {
  mac: KeyLabel;
  nonMac: KeyLabel;
  aria: string;
}

const ENTER: NamedKey = {
  mac: { label: "⏎", spoken: "Enter" },
  nonMac: { label: "⏎", spoken: "Enter" },
  aria: "Enter",
};
const ESCAPE: NamedKey = { mac: { label: "Esc" }, nonMac: { label: "Esc" }, aria: "Escape" };
const BACKSPACE: NamedKey = {
  mac: { label: "⌫", spoken: "Delete" },
  nonMac: { label: "Backspace" },
  aria: "Backspace",
};

function arrow(glyph: string, spoken: string): NamedKey {
  const label = { label: glyph, spoken };
  return { mac: label, nonMac: label, aria: `Arrow${spoken}` };
}

function word(label: string, aria = label): NamedKey {
  return { mac: { label }, nonMac: { label }, aria };
}

const NAMED_KEYS: Readonly<Record<string, NamedKey>> = {
  enter: ENTER,
  return: ENTER,
  escape: ESCAPE,
  esc: ESCAPE,
  backspace: BACKSPACE,
  delete: BACKSPACE,
  space: { mac: { label: "␣", spoken: "Space" }, nonMac: { label: "Space" }, aria: "Space" },
  tab: { mac: { label: "⇥", spoken: "Tab" }, nonMac: { label: "Tab" }, aria: "Tab" },
  up: arrow("↑", "Up"),
  arrowup: arrow("↑", "Up"),
  down: arrow("↓", "Down"),
  arrowdown: arrow("↓", "Down"),
  left: arrow("←", "Left"),
  arrowleft: arrow("←", "Left"),
  right: arrow("→", "Right"),
  arrowright: arrow("→", "Right"),
  pageup: word("Page Up", "PageUp"),
  pagedown: word("Page Down", "PageDown"),
  home: word("Home"),
  end: word("End"),
  insert: word("Insert"),
};

interface ParsedKeys {
  modifiers: Modifier[];
  key: string;
}

/** "+" joins parts; a trailing "+" part is the plus key itself. */
function parseKeys(keys: string, isMac: boolean): ParsedKeys {
  const parts = keys.split("+");
  const key = parts.length > 1 && parts.at(-1) === "" ? "+" : (parts.pop() ?? "");
  const present = new Set<Modifier>();
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (modifier === undefined) continue;
    present.add(!isMac && modifier === "cmd" ? "ctrl" : modifier);
  }
  return { modifiers: MODIFIER_ORDER.filter((m) => present.has(m)), key };
}

function plainKeyLabel(key: string): string {
  if (key.length === 1 || /^f\d{1,2}$/i.test(key)) return key.toUpperCase();
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function keyLabelFor(key: string, isMac: boolean): KeyLabel {
  const named = NAMED_KEYS[key.toLowerCase()];
  if (named === undefined) return { label: plainKeyLabel(key) };
  return isMac ? named.mac : named.nonMac;
}

/** Platform-aware keycap labels for a "cmd+alt+r"-style keys string. */
export function formatKeys(keys: string, isMac: boolean): KeyLabel[] {
  const { modifiers, key } = parseKeys(keys, isMac);
  const modifierLabels = isMac ? MAC_MODIFIER_LABELS : NON_MAC_MODIFIER_LABELS;
  return [...modifiers.map((m) => ({ ...modifierLabels[m] })), { ...keyLabelFor(key, isMac) }];
}

/** `aria-keyshortcuts` value, e.g. "cmd+shift+o" → "Shift+Meta+o" on mac. */
export function toAriaKeyShortcuts(keys: string, isMac: boolean): string {
  const { modifiers, key } = parseKeys(keys, isMac);
  const named = NAMED_KEYS[key.toLowerCase()];
  return [...modifiers.map((m) => ARIA_MODIFIER_NAMES[m]), named?.aria ?? key].join("+");
}
