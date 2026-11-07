import {Fragment} from "react";

import {useIsMac} from "../../hooks/use-is-mac";
import {formatKeySequence, type KeyLabel} from "../../lib/shortcuts/format";

const KEYCAP_CLASS =
	"inline-flex shrink-0 items-center justify-center h-[calc(1em+6px)] rounded-r3 [color:var(--shortcut-cap-ink)] bg-transparent border border-[color:var(--shortcut-cap-line)] [font-family:inherit] [font-variation-settings:inherit] [line-height:1]";
const SQUARE_CLASS = "w-[calc(1em+6px)] px-0";
const WIDE_CLASS = "min-w-[calc(1em+6px)] px-[3px]";
/** A multi-letter keycap like upstream's literal "Tab" cap, which skips the Mac ⇥ glyph. */
export const WIDE_KEYCAP_CLASS = `${KEYCAP_CLASS} ${WIDE_CLASS}`;

/** Upstream's cds `Kbd`: one boxed caption keycap on its own, as a menu row's digit accelerator. */
export function Kbd({children}: {children: string}) {
	return (
		<kbd
			data-cds="Kbd"
			className={`text-caption ${KEYCAP_CLASS} ${children.length > 1 ? WIDE_CLASS : SQUARE_CLASS}`}
		>
			{children}
		</kbd>
	);
}

const WRAPPER_CLASS = {
	keycap: "inline-flex shrink-0 items-center gap-[2px] text-caption",
	text: "inline-flex shrink-0 items-baseline gap-[0.15em] text-caption",
} as const;

/** Upstream reverses chord caps under RTL; sequences keep reading order, so they omit it. */
const RTL_REVERSE_CLASS = "[&:where(:root[dir=rtl]_:dir(rtl))]:flex-row-reverse";
const THEN_CLASS = "px-[2px] [color:var(--shortcut-cap-ink)]";
const TEXT_KBD_CLASS = "[font-family:inherit] [color:var(--shortcut-cap-ink)]";
/** Upstream's non-Mac "+" between text kbds: its negative margin cancels the wrapper gap. */
const PLUS_CLASS = "mx-[-0.15em] [color:var(--shortcut-cap-ink)]";

export type ShortcutVariant = keyof typeof WRAPPER_CLASS;

function Keycaps({labels}: {labels: KeyLabel[]}) {
	return labels.map((label, index) => (
		<kbd key={index} className={`${KEYCAP_CLASS} ${label.label.length > 1 ? WIDE_CLASS : SQUARE_CLASS}`}>
			<KeyGlyph label={label} />
		</kbd>
	));
}

function TextKeys({labels, isMac}: {labels: KeyLabel[]; isMac: boolean}) {
	return labels.map((label, index) => (
		<Fragment key={index}>
			{!isMac && index > 0 && <span className={PLUS_CLASS}>+</span>}
			{/* Upstream spells a glyph key's word off Mac in text hints ("Ctrl+Enter"), with no sr-only twin. */}
			<kbd className={TEXT_KBD_CLASS}>{isMac ? <KeyGlyph label={label} /> : (label.spoken ?? label.label)}</kbd>
		</Fragment>
	));
}

function KeyGlyph({label}: {label: KeyLabel}) {
	if (label.spoken === undefined) return label.label;
	return (
		<>
			<span aria-hidden="true">{label.label}</span>
			<span className="sr-only select-none">{label.spoken}</span>
		</>
	);
}

/** Platform-aware keycaps for a "shift+cmd+k"-style keys string, copied from claude.ai/code. */
export function Shortcut({
	keys,
	variant = "keycap",
	className,
	hidden = false,
}: {
	keys: string;
	variant?: ShortcutVariant;
	className?: string;
	/** Upstream's row hints are `aria-hidden`: the row's `aria-keyshortcuts` already names the keys. */
	hidden?: boolean;
}) {
	const isMac = useIsMac();
	const steps = formatKeySequence(keys, isMac);
	/* Upstream tailwind-merges the consumer's className, so a menu hint's text-footnote replaces text-caption. */
	const wrapper = className?.split(" ").includes("text-footnote")
		? WRAPPER_CLASS[variant].replace(" text-caption", "")
		: WRAPPER_CLASS[variant];
	const baseClass = steps.length > 1 ? wrapper : `${wrapper} ${RTL_REVERSE_CLASS}`;
	const wrapperClass = className ? `${baseClass} ${className}` : baseClass;

	return (
		<span
			data-cds="Shortcut"
			data-variant={variant}
			aria-hidden={hidden ? "true" : undefined}
			className={wrapperClass}
		>
			{steps.map((labels, index) => (
				<Fragment key={index}>
					{index > 0 && <span className={THEN_CLASS}>then</span>}
					{variant === "keycap" ? <Keycaps labels={labels} /> : <TextKeys labels={labels} isMac={isMac} />}
				</Fragment>
			))}
		</span>
	);
}
