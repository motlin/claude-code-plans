import {useJumpHint} from "../../lib/sidebar-jump-hints";

/**
 * Upstream `VZ`: a row's digit keycap while Ctrl+Shift is held, the row wrapper's last child. The class
 * string is upstream's with `--df-*` mapped to `--sb-*`; inside the session list globals.css moves it to
 * the trailing control slot.
 */
export function JumpHint({rowKey}: {rowKey: string})
{
	const digit = useJumpHint(rowKey);
	if (digit === null) return null;
	return (
		<kbd
			aria-hidden="true"
			className="df-jump-hint pointer-events-none absolute top-[calc(var(--sb-row-h)/2)] -translate-y-1/2 start-[calc(var(--sb-row-px)+var(--sb-rail-shift,0px)+(var(--sb-leading-slot)-1rem*var(--cds-rem-scale,1))/2)] flex h-4 min-w-4 items-center justify-center rounded-r2 border-[0.5px] bg-surface-1 px-[3px] font-sans text-[length:calc(0.625rem*var(--cds-rem-scale,1))] font-medium leading-none text-primary"
		>
			{digit}
		</kbd>
	);
}
