import {defaultKeymap, selectAll} from "@codemirror/commands";
import {bracketMatching, foldKeymap} from "@codemirror/language";
import {Annotation, Compartment, EditorState, type Extension, Prec} from "@codemirror/state";
import
{
	crosshairCursor,
	drawSelection,
	EditorView,
	highlightActiveLine,
	highlightActiveLineGutter,
	highlightWhitespace,
	keymap,
	lineNumbers,
	rectangularSelection,
	scrollPastEnd,
} from "@codemirror/view";
import type {ThemedToken} from "@shikijs/core";
import
{
	type HTMLAttributes,
	type Ref,
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
} from "react";

import {type HashLineRange, useLineHash} from "../../hooks/use-line-hash";
import {createAutoSave, type SaveReason} from "../../lib/source-save";
import
{
	bracketPairColors,
	findExtension,
	type FindHighlight,
	findRanges,
	foldingExtension,
	hangingIndent,
	indentGuides as indentGuidesExtension,
	jumpRangeExtension,
	setFindHighlight,
	setJumpRange,
	shikiExtension,
	shikiPaletteTheme,
	shikiUpdate,
	sourceEditorTheme,
} from "./source-editor-extensions";

export type {FindHighlight} from "./source-editor-extensions";

export interface SourceEditorHandle
{
	/** Replace the document with `text` (the disk contents) and report it clean. */
	reset(text: string): void;
	getValue(): string | undefined;
	focus(): void;
	hasFocus(): boolean;
	/** Move the caret to `line` (and 1-based `column`), centre it and focus the editor. */
	goTo(line: number, column?: number): void;
	selectAll(): void;
	/** The main selection's text; empty when it is a caret. */
	selectedText(): string;
	/** The whole lines the main selection touches, or null for a caret. */
	selectedLines():
	{
		start: number;
		end: number;
		text: string;
	} | null;
}

export interface SourceEditorProps
{
	/** The disk contents; the editor is dirty while its document differs from this. */
	value: string;
	readOnly?: boolean;
	ariaLabel?: string;
	/** Save after 1s idle, on blur, when the tab is hidden and on unmount (upstream `autoSave`). */
	autoSave?: boolean;
	/** Escape in manual mode keeps the draft instead of discarding it. */
	escapeKeepsDraft?: boolean;
	/** Called with the dirty flag on every document change, and `false` on reset and unmount. */
	onChange?: (dirty: boolean) => void;
	onSave?: (text: string, reason: SaveReason) => void;
	onDiscard?: () => void;
	/** Return true when handled; otherwise Escape bubbles. */
	onEscape?: () => boolean;
	ref?: Ref<SourceEditorHandle>;
	/** Files settings "Word wrap"; upstream defaults it on. */
	wordWrap?: boolean;
	/** Files settings "Tab size"; upstream defaults it to 4. */
	tabSize?: number;
	/** Files settings "Show whitespace"; upstream defaults it off. */
	showWhitespace?: boolean;
	/** Files settings "Scroll past end"; upstream defaults it off. */
	scrollPastEnd?: boolean;
	/** Files settings "Indent guides"; the editor defaults it off like upstream's `EpitaxyCodeMirrorFile`. */
	indentGuides?: boolean;
	/** Shiki tokens for the document's lines, drawn as `cm-shikiColorN` marks. */
	tokens?: ThemedToken[][] | null | undefined;
	/** The `data-language` on `.cm-content`; "markdown" also folds by heading. */
	language?: string | null | undefined;
	/** Select and centre this line, painting `line..endLine` as the jump range, whenever they change. */
	line?: number | undefined;
	endLine?: number | undefined;
	/** Follow `#L<n>[-L<m>]` in the page URL. */
	hashNavigation?: boolean;
	/** Ctrl-G; upstream opens the go to line bar. */
	onGoToLine?: (() => void) | undefined;
	/** The caret's one-based line and the document's line count, on mount and whenever they change. */
	onCaretChange?: ((line: number, lines: number) => void) | undefined;
	/** Find in file matches; the active one scrolls into view whenever `nonce` changes. */
	findHighlight?: FindHighlight | null | undefined;
	className?: string;
	/** Extra attributes for the host div that CodeMirror mounts `.cm-editor` into. */
	hostProps?: HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string | undefined>;
}

/**
 * Upstream's File editor read-only extension (`Ou`, chunk cbd02b8f2). It deliberately does
 * not add `EditorView.editable.of(false)`: `.cm-content` keeps `contenteditable="true"` with
 * `aria-readonly="true"`, so the caret, keyboard selection and Ctrl-G still work. (The
 * files-source-editor-autosave T3 / memory-dialog-inline-editor T4 specs cite `du`, which is
 * the held-text sheet `EpitaxyCodeMirrorText`, not this editor.)
 */
function readOnlyExtension(readOnly: boolean): Extension
{
	return readOnly
		? [
				EditorState.readOnly.of(true),
				drawSelection(
					{
						cursorBlinkRate: 0,
					},
				),
			]
		: [EditorState.readOnly.of(false), drawSelection()];
}

/** Marks document changes made from the disk contents, which are not edits. */
const fromDisk = Annotation.define<boolean>();

function wrapExtension(wordWrap: boolean): Extension
{
	return wordWrap ? [EditorView.lineWrapping, hangingIndent()] : [];
}

function contentAttributes(ariaLabel: string, language: string | null | undefined): Extension
{
	return EditorView.contentAttributes.of(
		{
			"aria-label": ariaLabel,
			...(language
				?
					{
						"data-language": language,
					}
				: {}),
		},
	);
}

function caretOf(state: EditorState): [number, number]
{
	return [state.doc.lineAt(state.selection.main.head).number, state.doc.lines];
}

/**
 * CodeMirror source view shared by the Files viewer and the editable source editors. The save
 * wiring is upstream's `EpitaxyCodeMirrorFile` (`cbd02b8f2`): every flush reason except
 * `"explicit"` saves only with autosave on and a dirty document.
 */
export function SourceEditor(props: SourceEditorProps)
{
	const
	{
		value,
		readOnly = false,
		wordWrap = true,
		tabSize = 4,
		showWhitespace = false,
		scrollPastEnd: pastEnd = false,
		indentGuides = false,
		tokens,
		language,
		line,
		endLine,
		hashNavigation = false,
		findHighlight,
		ariaLabel = "File contents",
		className,
		hostProps,
		ref,
	} = props;
	const hostRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef<EditorView | null>(null);
	const compartments = useRef(
		{
			readOnly: new Compartment(),
			wrap: new Compartment(),
			tabSize: new Compartment(),
			attributes: new Compartment(),
			whitespace: new Compartment(),
			pastEnd: new Compartment(),
			folding: new Compartment(),
			brackets: new Compartment(),
			palette: new Compartment(),
			indentGuides: new Compartment(),
		},
	).current;
	// The mount effect reads the first render's props; later changes go through the effects below.
	const initial = useRef(
		{
			value,
			readOnly,
			wordWrap,
			tabSize,
			ariaLabel,
			language,
			showWhitespace,
			pastEnd,
			indentGuides,
		},
	).current;
	const latest = useRef(props);
	const disk = useRef(value);
	useLayoutEffect(() =>
	{
		latest.current = props;
	});

	useEffect(() =>
	{
		const parent = hostRef.current;
		if (!parent) return undefined;
		const isDirty = (view: EditorView) => view.state.doc.toString() !== disk.current;
		const auto = createAutoSave(
			{
				save: (reason) =>
				{
					const view = viewRef.current;
					if (!view) return;
					const {autoSave = false, onSave} = latest.current;
					if (reason === "explicit" || (autoSave && isDirty(view)))
						onSave?.(view.state.doc.toString(), reason);
				},
			},
		);
		const view = new EditorView(
			{
				parent,
				state: EditorState.create(
					{
						doc: initial.value,
						extensions: [
							Prec.high(
								keymap.of([
									{
										key: "Mod-s",
										run: (target) =>
										{
											if (target.state.readOnly) return false;
											auto.flush("explicit");
											return true;
										},
									},
									{
										key: "Escape",
										stopPropagation: true,
										run: (target) =>
										{
											const
											{
												autoSave = false,
												escapeKeepsDraft = false,
												onDiscard,
												onEscape,
											} = latest.current;
											if (!autoSave && isDirty(target))
											{
												if (!escapeKeepsDraft) onDiscard?.();
												return true;
											}
											return onEscape?.() === true;
										},
									},
									{
										key: "Ctrl-g",
										run: () =>
										{
											const {onGoToLine} = latest.current;
											onGoToLine?.();
											return onGoToLine !== undefined;
										},
									},
								]),
							),
							lineNumbers(),
							compartments.folding.of(foldingExtension(initial.language)),
							highlightActiveLine(),
							highlightActiveLineGutter(),
							EditorState.allowMultipleSelections.of(true),
							rectangularSelection(),
							crosshairCursor(),
							bracketMatching(),
							compartments.brackets.of(bracketPairColors(initial.language)),
							keymap.of([...defaultKeymap, ...foldKeymap]),
							compartments.attributes.of(contentAttributes(initial.ariaLabel, initial.language)),
							sourceEditorTheme,
							shikiExtension,
							compartments.palette.of([]),
							jumpRangeExtension,
							findExtension,
							compartments.whitespace.of(initial.showWhitespace ? highlightWhitespace() : []),
							compartments.pastEnd.of(initial.pastEnd ? scrollPastEnd() : []),
							compartments.indentGuides.of(initial.indentGuides ? indentGuidesExtension() : []),
							compartments.readOnly.of(readOnlyExtension(initial.readOnly)),
							compartments.wrap.of(wrapExtension(initial.wordWrap)),
							compartments.tabSize.of(EditorState.tabSize.of(initial.tabSize)),
							EditorView.updateListener.of((update) =>
							{
								if (update.selectionSet || update.docChanged)
								{
									const [caretLine, lines] = caretOf(update.state);
									const [previousLine, previousLines] = caretOf(update.startState);
									if (caretLine !== previousLine || lines !== previousLines)
										latest.current.onCaretChange?.(caretLine, lines);
								}
								if (!update.docChanged || update.transactions.some((tr) => tr.annotation(fromDisk)))
									return;
								latest.current.onChange?.(isDirty(update.view));
								auto.change();
							}),
							EditorView.domEventHandlers(
								{
									blur: () =>
									{
										auto.flush("blur");
									},
								},
							),
						],
					},
				),
			},
		);
		viewRef.current = view;
		latest.current.onCaretChange?.(...caretOf(view.state));
		const doc = parent.ownerDocument;
		const win = doc.defaultView;
		const onVisibility = () =>
		{
			if (doc.visibilityState === "hidden") auto.flush("hidden");
		};
		// Upstream treats its own (iframe) window's pagehide as hidden and the top window's as unload.
		const onFramePagehide = () =>
		{
			auto.flush("hidden");
		};
		const onPagehide = () =>
		{
			auto.flush("unload");
		};
		doc.addEventListener("visibilitychange", onVisibility);
		if (win && win !== window) win.addEventListener("pagehide", onFramePagehide);
		window.addEventListener("pagehide", onPagehide);
		return () =>
		{
			doc.removeEventListener("visibilitychange", onVisibility);
			if (win && win !== window) win.removeEventListener("pagehide", onFramePagehide);
			window.removeEventListener("pagehide", onPagehide);
			auto.dispose(true);
			view.destroy();
			viewRef.current = null;
			latest.current.onChange?.(false);
		};
	}, [compartments, initial]);

	useImperativeHandle(
		ref,
		() => (
		{
			reset: (text) =>
			{
				const view = viewRef.current;
				if (!view) return;
				view.dispatch(
					{
						changes:
						{
							from: 0,
							to: view.state.doc.length,
							insert: text,
						},
						annotations: fromDisk.of(true),
					},
				);
				latest.current.onChange?.(false);
			},
			getValue: () => viewRef.current?.state.doc.toString(),
			focus: () => viewRef.current?.focus(),
			hasFocus: () => viewRef.current?.hasFocus ?? false,
			goTo: (target, column = 1) =>
			{
				const view = viewRef.current;
				if (!view) return;
				const {doc} = view.state;
				const targetLine = doc.line(Math.min(Math.max(target, 1), doc.lines));
				const pos = Math.min(targetLine.from + Math.max(column, 1) - 1, targetLine.to);
				view.dispatch(
					{
						selection:
						{
							anchor: pos,
						},
						effects: EditorView.scrollIntoView(
							pos,
							{
								y: "center",
							},
						),
					},
				);
				view.focus();
			},
			selectAll: () =>
			{
				const view = viewRef.current;
				if (view) selectAll(view);
			},
			selectedText: () =>
			{
				const state = viewRef.current?.state;
				if (!state) return "";
				const {from, to} = state.selection.main;
				return state.sliceDoc(from, to);
			},
			selectedLines: () =>
			{
				const state = viewRef.current?.state;
				if (!state || state.selection.main.empty) return null;
				const first = state.doc.lineAt(state.selection.main.from);
				const last = state.doc.lineAt(state.selection.main.to);
				return {
					start: first.number,
					end: last.number,
					text: state.sliceDoc(first.from, last.to),
				};
			},
		}),
		[],
	);

	// Upstream `Zr`: new disk contents replace a clean document and leave a dirty draft alone.
	useEffect(() =>
	{
		const previous = disk.current;
		disk.current = value;
		const view = viewRef.current;
		if (!view || value === previous) return;
		const text = view.state.doc.toString();
		if (text !== previous) return;
		view.dispatch(
			{
				changes:
				{
					from: 0,
					to: view.state.doc.length,
					insert: value,
				},
				annotations: fromDisk.of(true),
			},
		);
		latest.current.onChange?.(false);
	}, [value]);

	useEffect(() =>
	{
		viewRef.current?.dispatch(
			{
				effects: compartments.readOnly.reconfigure(readOnlyExtension(readOnly)),
			},
		);
	}, [compartments, readOnly]);

	useEffect(() =>
	{
		viewRef.current?.dispatch(
			{
				effects: compartments.attributes.reconfigure(contentAttributes(ariaLabel, language)),
			},
		);
	}, [compartments, ariaLabel, language]);

	useEffect(() =>
	{
		viewRef.current?.dispatch(
			{
				effects: [
					compartments.folding.reconfigure(foldingExtension(language)),
					compartments.brackets.reconfigure(bracketPairColors(language)),
				],
			},
		);
	}, [compartments, language]);

	useEffect(() =>
	{
		viewRef.current?.dispatch(
			{
				effects: [
					compartments.whitespace.reconfigure(showWhitespace ? highlightWhitespace() : []),
					compartments.pastEnd.reconfigure(pastEnd ? scrollPastEnd() : []),
				],
			},
		);
	}, [compartments, showWhitespace, pastEnd]);

	useEffect(() =>
	{
		const view = viewRef.current;
		if (!view) return;
		const {effect, palette} = shikiUpdate(view.state.doc, tokens);
		view.dispatch(
			{
				effects: [effect, compartments.palette.reconfigure(shikiPaletteTheme(palette))],
			},
		);
	}, [compartments, tokens, value]);

	const jumpTo = useCallback((range: HashLineRange | null) =>
	{
		const view = viewRef.current;
		if (!view) return;
		if (range === null || range.line > view.state.doc.lines)
		{
			view.dispatch(
				{
					effects: setJumpRange.of(null),
				},
			);
			return;
		}
		const pos = view.state.doc.line(range.line).from;
		view.dispatch(
			{
				selection:
				{
					anchor: pos,
				},
				effects: [
					setJumpRange.of(
						{
							line: range.line,
							endLine: Math.max(range.line, range.endLine),
						},
					),
					EditorView.scrollIntoView(
						pos,
						{
							y: "center",
						},
					),
				],
			},
		);
	}, []);

	useLineHash(hashNavigation, jumpTo);

	useEffect(() =>
	{
		if (line !== undefined)
			jumpTo(
				{
					line,
					endLine: endLine ?? line,
				},
			);
	}, [jumpTo, line, endLine]);

	const findQuery = findHighlight?.query;
	const findActive = findHighlight?.active;
	const findNonce = findHighlight?.nonce;
	useEffect(() =>
	{
		const view = viewRef.current;
		if (!view) return;
		if (findQuery === undefined || findActive === undefined || findNonce === undefined)
		{
			view.dispatch(
				{
					effects: setFindHighlight.of(null),
				},
			);
			return;
		}
		const target = findRanges(view.state.doc, findQuery)[findActive];
		view.dispatch(
			{
				effects: [
					setFindHighlight.of(
						{
							query: findQuery,
							active: findActive,
							nonce: findNonce,
						},
					),
					...(target === undefined
						? []
						: [
								EditorView.scrollIntoView(
									target.from,
									{
										y: "center",
									},
								),
							]),
				],
			},
		);
	}, [findQuery, findActive, findNonce]);

	useEffect(() =>
	{
		viewRef.current?.dispatch(
			{
				effects: compartments.wrap.reconfigure(wrapExtension(wordWrap)),
			},
		);
	}, [compartments, wordWrap]);

	useEffect(() =>
	{
		viewRef.current?.dispatch(
			{
				effects: compartments.indentGuides.reconfigure(indentGuides ? indentGuidesExtension() : []),
			},
		);
	}, [compartments, indentGuides]);

	useEffect(() =>
	{
		viewRef.current?.dispatch(
			{
				effects: compartments.tabSize.reconfigure(EditorState.tabSize.of(tabSize)),
			},
		);
	}, [compartments, tabSize]);

	return <div {...hostProps} ref={hostRef} className={className} />;
}
