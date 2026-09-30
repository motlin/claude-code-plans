import {useIsMac} from "../../hooks/use-is-mac";
import {formatKeys, type KeyLabel} from "../../lib/shortcuts/format";

const KEYCAP_CLASS =
	"inline-flex shrink-0 items-center justify-center h-[calc(1em+6px)] rounded-r3 [color:var(--shortcut-cap-ink)] bg-transparent border border-[color:var(--shortcut-cap-line)] [font-family:inherit] [font-variation-settings:inherit] [line-height:1]";
const SQUARE_CLASS = "w-[calc(1em+6px)] px-0";
const WIDE_CLASS = "min-w-[calc(1em+6px)] px-[3px]";

const WRAPPER_CLASS = {
	keycap: "inline-flex shrink-0 items-center gap-[2px] text-caption",
	text: "inline-flex shrink-0 items-baseline gap-[0.3em] text-caption",
} as const;

export type ShortcutVariant = keyof typeof WRAPPER_CLASS;

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
	const labels = formatKeys(keys, isMac);
	const wrapperClass = className ? `${WRAPPER_CLASS[variant]} ${className}` : WRAPPER_CLASS[variant];

	return (
		<span data-cds="Shortcut" data-variant={variant} className={wrapperClass}>
			{variant === "keycap" ? (
				labels.map((label, index) => (
					<kbd
						key={index}
						className={`${KEYCAP_CLASS} ${label.label.length > 1 ? WIDE_CLASS : SQUARE_CLASS}`}
					>
						<KeyGlyph label={label} />
					</kbd>
				))
			) : (
				<kbd className="[font-family:inherit] [color:var(--shortcut-cap-ink)]">
					{isMac
						? labels.map((label, index) => <KeyGlyph key={index} label={label} />)
						: labels.map((label) => label.label).join("+")}
				</kbd>
			)}
		</span>
	);
}
