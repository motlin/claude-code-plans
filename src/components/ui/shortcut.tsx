import {Fragment} from "react";

import {useIsMac} from "../../hooks/use-is-mac";
import {formatKeySequence, type KeyLabel} from "../../lib/shortcuts/format";

const KEYCAP_CLASS =
	"inline-flex shrink-0 items-center justify-center h-[calc(1em+6px)] rounded-r3 [color:var(--shortcut-cap-ink)] bg-transparent border border-[color:var(--shortcut-cap-line)] [font-family:inherit] [font-variation-settings:inherit] [line-height:1]";
const SQUARE_CLASS = "w-[calc(1em+6px)] px-0";
const WIDE_CLASS = "min-w-[calc(1em+6px)] px-[3px]";
/** A multi-letter keycap like upstream's literal "Tab" cap, which skips the Mac ⇥ glyph. */
export const WIDE_KEYCAP_CLASS = `${KEYCAP_CLASS} ${WIDE_CLASS}`;

const WRAPPER_CLASS = {
	keycap: "inline-flex shrink-0 items-center gap-[2px] text-caption",
	text: "inline-flex shrink-0 items-baseline gap-[0.3em] text-caption",
} as const;

/** Upstream reverses chord caps under RTL; sequences keep reading order, so they omit it. */
const RTL_REVERSE_CLASS = "[&:where(:root[dir=rtl]_:dir(rtl))]:flex-row-reverse";
const THEN_CLASS = "px-[2px] [color:var(--shortcut-cap-ink)]";

export type ShortcutVariant = keyof typeof WRAPPER_CLASS;

function Keycaps({labels}: {labels: KeyLabel[]}) {
	return labels.map((label, index) => (
		<kbd key={index} className={`${KEYCAP_CLASS} ${label.label.length > 1 ? WIDE_CLASS : SQUARE_CLASS}`}>
			<KeyGlyph label={label} />
		</kbd>
	));
}

function TextKeys({labels, isMac}: {labels: KeyLabel[]; isMac: boolean}) {
	if (!isMac) return labels.map((label) => label.label).join("+");
	return labels.map((label, index) => <KeyGlyph key={index} label={label} />);
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
}: {
	keys: string;
	variant?: ShortcutVariant;
	className?: string;
}) {
	const isMac = useIsMac();
	const steps = formatKeySequence(keys, isMac);
	const baseClass = steps.length > 1 ? WRAPPER_CLASS[variant] : `${WRAPPER_CLASS[variant]} ${RTL_REVERSE_CLASS}`;
	const wrapperClass = className ? `${baseClass} ${className}` : baseClass;

	return (
		<span data-cds="Shortcut" data-variant={variant} className={wrapperClass}>
			{variant === "keycap" ? (
				steps.map((labels, index) => (
					<Fragment key={index}>
						{index > 0 && <span className={THEN_CLASS}>then</span>}
						<Keycaps labels={labels} />
					</Fragment>
				))
			) : (
				<kbd className="[font-family:inherit] [color:var(--shortcut-cap-ink)]">
					{steps.map((labels, index) => (
						<Fragment key={index}>
							{index > 0 && " then "}
							<TextKeys labels={labels} isMac={isMac} />
						</Fragment>
					))}
				</kbd>
			)}
		</span>
	);
}
