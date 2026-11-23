import {type KeyboardEvent, useEffect, useRef, useState} from "react";

import {parseGoToLine} from "../../lib/go-to-line";
import {Icon} from "../ui/icon";
import {Field, TextInput} from "../ui/text-input";
import {Tooltip} from "../ui/tooltip";

/** Upstream's panel subheader around the bar: no padding of its own. */
const SUBHEADER_CLASS = "epitaxy-panel-subheader shrink-0 bg-alpha-1";

/** Upstream cds `Toolbar`: the panels' comfortable pads make it 44px tall with 8px padding and a 4px gap. */
const TOOLBAR_CLASS =
	"flex shrink-0 items-center gap-1 px-[var(--cds-toolbar-pad-inline,0px)] pt-[var(--cds-toolbar-pad-block,0.25rem)] pb-[var(--cds-toolbar-pad-block,0.25rem)]";

/* Upstream's ghost icon-only close button at the control height. */
const CLOSE_BUTTON =
	"flex size-[var(--cds-h-control)] shrink-0 cursor-pointer items-center justify-center rounded-[var(--upstream-radius)] text-primary hover:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

export interface GoToLineBarProps
{
	/** The caret's one-based line and the file's line count. */
	caret:
	{
		line: number;
		lines: number;
	};
	onGo: (line: number, column: number | undefined) => void;
	/** Escape and the close button refocus the editor; focus leaving the bar does not. */
	onClose: (refocus: boolean) => void;
	/** Bumped by Ctrl-G in the editor while the bar is open, to re-select the input. */
	focusRequest?: number;
}

/**
 * Upstream's go to line bar (viewer `Dc`): a subheader above the file with a `line[:column]` input,
 * a live "Line n of N" status that turns into the valid range while the input is invalid, and a close
 * button. Enter goes, Escape closes, Ctrl-G re-selects the input and focus leaving the bar closes it.
 */
export function GoToLineBar({caret, onGo, onClose, focusRequest = 0}: GoToLineBarProps)
{
	const [text, setText] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const target = parseGoToLine(text, caret.lines);
	const invalid = text.trim() !== "" && target === null;

	useEffect(() =>
	{
		inputRef.current?.focus();
		inputRef.current?.select();
	}, [focusRequest]);

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) =>
	{
		if (event.key === "Enter")
		{
			// oxlint-disable-next-line typescript/no-deprecated -- Safari reports IME keydowns only as keyCode 229, as upstream checks
			if (event.nativeEvent.isComposing || event.keyCode === 229) return;
			event.preventDefault();
			if (target !== null) onGo(target.line, target.column);
		}
		else if (event.key === "Escape")
		{
			event.preventDefault();
			event.stopPropagation();
			onClose(true);
		}
		else if (event.key.toLowerCase() === "g" && event.ctrlKey && !event.metaKey && !event.altKey)
		{
			event.preventDefault();
			inputRef.current?.select();
		}
	};

	return (
		// oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- keeps focus in the input when the bar's chrome is pressed
		<div
			data-pane-editor="true"
			className={SUBHEADER_CLASS}
			onMouseDown={(event) =>
			{
				if (event.target !== inputRef.current) event.preventDefault();
			}}
			onBlur={(event) =>
			{
				if (!event.currentTarget.contains(event.relatedTarget)) onClose(false);
			}}
		>
			<div role="toolbar" aria-label="Go to line controls" data-cds="Toolbar" className={TOOLBAR_CLASS}>
				<div className="flex min-w-0 flex-1 items-center gap-1 self-stretch">
					<div className="flex min-w-0 flex-1 items-center gap-[4px] min-h-control">
						<Field className="min-w-0 flex-1" invalid={invalid}>
							<TextInput
								ref={inputRef}
								aria-label="Go to line"
								placeholder="Line, or line:column"
								autoComplete="off"
								spellCheck={false}
								value={text}
								onChange={(event) =>
								{
									setText(event.target.value);
								}}
								onKeyDown={handleKeyDown}
							/>
						</Field>
						<span aria-live="polite" className="text-footnote text-muted-as-secondary tabular-nums">
							{invalid
								? `Type a line number from 1 to ${caret.lines}`
								: `Line ${caret.line} of ${caret.lines}`}
						</span>
					</div>
				</div>
				<Tooltip content="Close" shortcut="esc" triggerIsChild>
					<button
						type="button"
						data-cds="Button"
						data-cds-ghost=""
						data-cds-icon-only=""
						aria-label="Close go to line bar"
						aria-keyshortcuts="Escape"
						onClick={() =>
						{
							onClose(true);
						}}
						className={CLOSE_BUTTON}
					>
						<Icon name="X" size="sm" />
					</button>
				</Tooltip>
			</div>
		</div>
	);
}
