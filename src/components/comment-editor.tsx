import {MessageSquarePlus, Pencil, Trash2} from "lucide-react";
import {
	type CSSProperties,
	type FocusEvent,
	type KeyboardEvent,
	type MouseEvent,
	type ReactNode,
	type Ref,
	type RefObject,
	useLayoutEffect,
	useRef,
} from "react";

import {Tooltip} from "./ui/tooltip";

/**
 * Port of upstream's shared comment editor (`M` + card `pe` in cdf69fdd3): the inline card under a diff line
 * and the floating body of the plan "Comment on selection" popover. Saved comments render as the same card
 * with a clickable body and hover/focus/touch-revealed Edit and Delete.
 */
export type CommentEditorProps = {
	/** `inline` (diff cards, default) draws the bordered card in a padded wrapper; `floating` fills its popover. */
	variant?: "inline" | "floating";
	label?: ReactNode;
	value: string;
	onChange: (value: string) => void;
	isEditing?: boolean;
	/** The accent border of the card being drafted or edited (inline only). */
	isActive?: boolean;
	inputLabel?: string;
	saveLabel?: string;
	saveShortcut?: string;
	saveIcon?: ReactNode;
	placeholder?: string;
	/** Disables Save, becomes its tooltip and shows as a status line under the editor. */
	saveDisabledReason?: string;
	saveWhenEmpty?: boolean;
	autoFocus?: boolean;
	inputRef?: RefObject<HTMLTextAreaElement | null>;
	inputReadOnly?: boolean;
	/** Shown before Edit/Delete on a saved card, e.g. "Posting…". */
	readStatus?: ReactNode;
	onSave: (text: string, options: {submit: boolean; viaKeyboard: boolean}) => void;
	/** Replaces the ⌘/Ctrl+Enter save. */
	onChordEnter?: (text: string) => void;
	onCancel: () => void;
	onDelete?: (() => void) | undefined;
	onActivate?: (() => void) | undefined;
	onInputBlur?: (event: FocusEvent<HTMLTextAreaElement>) => void;
	leadingActions?: ReactNode;
	saveAction?: ReactNode;
	cardRef?: Ref<HTMLDivElement>;
};

const ICON_BUTTON_CLASS =
	"rounded-sm p-0.75 text-ink-muted hover:bg-fill-ghost-hover hover:text-primary disabled:opacity-40";
const REVEAL_BUTTON_CLASS =
	"relative rounded-sm p-0.75 text-ink-muted opacity-0 transition-opacity motion-reduce:transition-none hover:bg-fill-ghost-hover focus-visible:opacity-100 group-hover/card:opacity-100 group-focus-within/card:opacity-100 touch:opacity-100";
const TEXTAREA_CLASS =
	"hide-focus-ring focus-visible:outline-hidden flex-1 min-w-0 resize-none border-none bg-transparent text-pane text-primary placeholder:text-ink-muted";
const BODY_CLASS =
	"hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus rounded-r2 flex-1 min-w-0 cursor-text select-text whitespace-pre-wrap break-words text-pane text-primary before:absolute before:inset-0 before:content-['']";
const PLAIN_BODY_CLASS = "flex-1 min-w-0 whitespace-pre-wrap break-words text-pane text-primary";
/** Upstream `text-footnote` in the compact main column (12/15); swap once the density tokens make footnote 12/15. */
const FOOTNOTE_MUTED_CLASS = "text-[12px] leading-[15px] text-ink-muted";
const CARD_BASE_CLASS = "group/card relative isolate flex flex-col transition-colors gap-1.5 px-3 py-2.5 font-sans";

const INLINE_TEXTAREA_STYLE: CSSProperties = {fieldSizing: "content"};
const FLOATING_TEXTAREA_STYLE: CSSProperties = {fieldSizing: "content", maxHeight: "8lh"};
const ACTIVE_STYLE: CSSProperties = {borderColor: "var(--color-fill-accent)"};

function hasModifier(event: KeyboardEvent): boolean {
	return event.metaKey || event.ctrlKey || event.altKey;
}

export function CommentEditor({
	variant = "inline",
	label,
	value,
	onChange,
	isEditing = false,
	isActive = false,
	inputLabel = "Comment",
	saveLabel = "Save comment",
	saveShortcut,
	saveIcon,
	placeholder = "Add a comment",
	saveDisabledReason,
	saveWhenEmpty = false,
	autoFocus = false,
	inputRef,
	inputReadOnly = false,
	readStatus,
	onSave,
	onChordEnter,
	onCancel,
	onDelete,
	onActivate,
	onInputBlur,
	leadingActions,
	saveAction,
	cardRef,
}: CommentEditorProps) {
	const ownRef = useRef<HTMLTextAreaElement>(null);
	const textareaRef = inputRef ?? ownRef;
	const floating = variant === "floating";
	const blocked = saveDisabledReason !== undefined;

	useLayoutEffect(() => {
		if (!autoFocus) return;
		const textarea = textareaRef.current;
		if (textarea === null) return;
		textarea.focus();
		textarea.setSelectionRange(textarea.value.length, textarea.value.length);
		textarea.scrollTop = textarea.scrollHeight;
	}, [autoFocus, textareaRef]);

	const save = (viaKeyboard: boolean, submit: boolean) => {
		const text = value.trim();
		if ((text === "" && !saveWhenEmpty) || blocked) return;
		onSave(text, {submit, viaKeyboard});
	};

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		// oxlint-disable-next-line typescript/no-deprecated -- Safari reports the IME-commit Enter only as keyCode 229, as upstream checks
		if (event.nativeEvent.isComposing || event.keyCode === 229) return;
		if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
			event.preventDefault();
			event.stopPropagation();
			if (event.repeat) return;
			const chord = event.metaKey || event.ctrlKey;
			if (chord && onChordEnter !== undefined && !blocked) onChordEnter(value.trim());
			else save(true, chord);
		} else if (event.key === "Escape") {
			event.preventDefault();
			if (event.currentTarget.closest('[role="dialog"], [role="alertdialog"]') !== null) event.stopPropagation();
			onCancel();
		}
	};

	const onBodyClick = (event: MouseEvent<HTMLDivElement>) => {
		const selection = event.currentTarget.ownerDocument.getSelection();
		if (
			selection?.isCollapsed === false &&
			(event.currentTarget.contains(selection.anchorNode) || event.currentTarget.contains(selection.focusNode))
		)
			return;
		onActivate?.();
	};

	let body: ReactNode;
	if (isEditing) {
		body = (
			<textarea
				ref={textareaRef}
				value={value}
				readOnly={inputReadOnly}
				onChange={(event) => {
					onChange(event.target.value);
				}}
				onKeyDown={onKeyDown}
				onBlur={onInputBlur}
				aria-label={inputLabel}
				placeholder={placeholder}
				rows={1}
				className={TEXTAREA_CLASS}
				style={floating ? FLOATING_TEXTAREA_STYLE : INLINE_TEXTAREA_STYLE}
			/>
		);
	} else if (onActivate === undefined) {
		body = <p className={PLAIN_BODY_CLASS}>{value}</p>;
	} else {
		body = (
			<div
				role="button"
				tabIndex={0}
				onClick={onBodyClick}
				onKeyDown={(event) => {
					if (hasModifier(event)) return;
					if (event.key === "Enter" || event.key === " ") event.preventDefault();
					if (event.key === "Enter") onActivate();
				}}
				onKeyUp={(event) => {
					if (event.key !== " " || hasModifier(event)) return;
					event.preventDefault();
					onActivate();
				}}
				className={BODY_CLASS}
			>
				<span className="relative">{value}</span>
			</div>
		);
	}

	const deleteButton =
		onDelete === undefined ? null : (
			<Tooltip content="Delete comment">
				<button
					type="button"
					onClick={onDelete}
					className={`${isEditing ? ICON_BUTTON_CLASS : REVEAL_BUTTON_CLASS} hover:text-danger-000`}
					aria-label="Delete comment"
				>
					<Trash2 className="size-3.5" aria-hidden />
				</button>
			</Tooltip>
		);

	const saveOnly = isEditing && leadingActions === undefined && onDelete === undefined;
	const slotClass = `shrink-0 h-6 flex items-center ${saveOnly ? "w-6 justify-center" : "gap-0.75"} ${isEditing ? "self-end" : "self-start"}`;
	const actions = isEditing ? (
		<>
			{leadingActions}
			{deleteButton}
			{saveAction ?? (
				<Tooltip
					content={saveDisabledReason ?? saveLabel}
					{...(blocked || saveShortcut === undefined ? {} : {shortcut: saveShortcut})}
				>
					<span className="inline-flex">
						<button
							type="button"
							disabled={(value.trim() === "" && !saveWhenEmpty) || blocked}
							onClick={() => {
								save(false, false);
							}}
							className={ICON_BUTTON_CLASS}
							aria-label={saveLabel}
						>
							{saveIcon ?? <MessageSquarePlus className="size-4" aria-hidden />}
						</button>
					</span>
				</Tooltip>
			)}
		</>
	) : (
		<>
			{readStatus}
			{onActivate === undefined ? null : (
				<Tooltip content="Edit comment">
					<button
						type="button"
						onClick={onActivate}
						className={`${REVEAL_BUTTON_CLASS} hover:text-primary`}
						aria-label="Edit comment"
					>
						<Pencil className="size-3.5" aria-hidden />
					</button>
				</Tooltip>
			)}
			{deleteButton}
		</>
	);

	const inline = variant === "inline";
	let cardClass = `${CARD_BASE_CLASS} ${floating ? "rounded-[inherit]" : "bg-surface-3"}`;
	if (inline) cardClass += isActive ? " rounded-r4 border" : " rounded-r4 border border-border";

	const card = (
		<div ref={cardRef} className={cardClass} style={inline && isActive ? ACTIVE_STYLE : undefined}>
			{label === undefined ? null : <div className={FOOTNOTE_MUTED_CLASS}>{label}</div>}
			<div className="flex items-center gap-1">
				{body}
				<div className={slotClass}>{actions}</div>
			</div>
			{isEditing && blocked ? (
				<p role="status" className={FOOTNOTE_MUTED_CLASS}>
					{saveDisabledReason}
				</p>
			) : null}
		</div>
	);
	return inline ? <div className="px-2 py-1">{card}</div> : card;
}
