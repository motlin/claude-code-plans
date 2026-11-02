import {defaultKeymap} from "@codemirror/commands";
import {Annotation, Compartment, EditorState, type Extension, Prec} from "@codemirror/state";
import
{
	drawSelection,
	EditorView,
	highlightActiveLine,
	highlightActiveLineGutter,
	keymap,
	lineNumbers,
} from "@codemirror/view";
import {type Ref, useEffect, useImperativeHandle, useLayoutEffect, useRef} from "react";
import {createAutoSave, type SaveReason} from "../../lib/source-save";

export interface SourceEditorHandle
{
	/** Replace the document with `text` (the disk contents) and report it clean. */
	reset(text: string): void;
	getValue(): string | undefined;
	focus(): void;
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
	className?: string;
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

/** Upstream's code theme (`ͼ3w`, overridden by `ͼo`), in local tokens. */
const sourceEditorTheme = EditorView.theme(
	{
		"&":
		{
			flex: "1 1 0%",
			minHeight: 0,
			height: "100%",
			backgroundColor: "var(--code-theme-bg, var(--color-surface-1))",
			color: "var(--code-theme-fg, var(--color-primary))",
		},
		"&.cm-focused":
		{
			outline: "none",
		},
		".cm-scroller":
		{
			fontFamily: "var(--font-mono)",
			lineHeight: "inherit",
			overflow: "auto",
		},
		".cm-content":
		{
			padding: "8px 0",
		},
		".cm-line":
		{
			padding: "0 12px 0 4px",
		},
		".cm-gutters":
		{
			backgroundColor: "inherit",
			color: "var(--muted-as-secondary)",
			border: "none",
		},
		".cm-gutters .cm-lineNumbers .cm-gutterElement":
		{
			padding: "0 0 0 18px",
			minWidth: "2rem",
			cursor: "default",
			userSelect: "none",
		},
		// Upstream paints rgba(255,255,255,.05) on its dark theme; currentColor keeps light themes legible.
		".cm-activeLine":
		{
			backgroundColor: "color-mix(in srgb, currentColor 5%, transparent)",
		},
		".cm-activeLineGutter":
		{
			backgroundColor: "transparent",
			color: "inherit",
		},
		".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground":
		{
			background: "rgba(0,153,255,.3)",
		},
		".cm-selectionMatch":
		{
			backgroundColor: "rgba(0,153,255,.14)",
		},
	},
);

/** Marks document changes made from the disk contents, which are not edits. */
const fromDisk = Annotation.define<boolean>();

function wrapExtension(wordWrap: boolean): Extension
{
	return wordWrap ? EditorView.lineWrapping : [];
}

/**
 * CodeMirror source view shared by the Files viewer and the editable source editors. The save
 * wiring is upstream's `EpitaxyCodeMirrorFile` (`cbd02b8f2`): every flush reason except
 * `"explicit"` saves only with autosave on and a dirty document.
 */
export function SourceEditor(props: SourceEditorProps)
{
	const {value, readOnly = false, wordWrap = true, tabSize = 4, ariaLabel = "File contents", className, ref} = props;
	const hostRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef<EditorView | null>(null);
	const compartments = useRef(
		{
			readOnly: new Compartment(),
			wrap: new Compartment(),
			tabSize: new Compartment(),
			ariaLabel: new Compartment(),
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
								]),
							),
							lineNumbers(),
							highlightActiveLine(),
							highlightActiveLineGutter(),
							EditorState.allowMultipleSelections.of(true),
							keymap.of(defaultKeymap),
							compartments.ariaLabel.of(
								EditorView.contentAttributes.of(
									{
										"aria-label": initial.ariaLabel,
									},
								),
							),
							sourceEditorTheme,
							compartments.readOnly.of(readOnlyExtension(initial.readOnly)),
							compartments.wrap.of(wrapExtension(initial.wordWrap)),
							compartments.tabSize.of(EditorState.tabSize.of(initial.tabSize)),
							EditorView.updateListener.of((update) =>
							{
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
				effects: compartments.ariaLabel.reconfigure(
					EditorView.contentAttributes.of(
						{
							"aria-label": ariaLabel,
						},
					),
				),
			},
		);
	}, [compartments, ariaLabel]);

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
				effects: compartments.tabSize.reconfigure(EditorState.tabSize.of(tabSize)),
			},
		);
	}, [compartments, tabSize]);

	return <div ref={hostRef} className={className} />;
}
