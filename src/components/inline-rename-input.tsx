import {useLayoutEffect, useRef} from "react";

const INPUT_CLASS =
	"hide-focus-ring min-w-0 w-full flex-1 border-none bg-transparent p-0 text-primary outline-none [font:inherit]";

/**
 * claude.ai/code's inline rename: an unbordered input in the title's own font
 * that opens with the whole text selected. Enter and blur commit, Escape
 * cancels; only the first of those counts.
 */
export function InlineRenameInput({
	value,
	onCommit,
	onCancel,
	className,
	ariaLabel = "Rename",
}: {
	value: string;
	onCommit: (value: string) => void;
	onCancel: () => void;
	className?: string;
	ariaLabel?: string;
}) {
	const ref = useRef<HTMLInputElement>(null);
	const settled = useRef(false);

	useLayoutEffect(() => {
		ref.current?.focus();
		ref.current?.select();
	}, []);

	const settle = (commit: boolean) => {
		if (settled.current) return;
		settled.current = true;
		if (commit) onCommit(ref.current?.value ?? value);
		else onCancel();
	};

	return (
		<input
			ref={ref}
			type="text"
			aria-label={ariaLabel}
			defaultValue={value}
			className={className ? `${INPUT_CLASS} ${className}` : INPUT_CLASS}
			onClick={(event) => {
				event.preventDefault();
				event.stopPropagation();
			}}
			onKeyDown={(event) => {
				event.stopPropagation();
				if (event.key === "Enter") {
					event.preventDefault();
					settle(true);
				} else if (event.key === "Escape") {
					event.preventDefault();
					settle(false);
				}
			}}
			onBlur={() => settle(true)}
		/>
	);
}
