import {defaultKeymap} from "@codemirror/commands";
import {Compartment, EditorState, type Extension} from "@codemirror/state";
import {
	drawSelection,
	EditorView,
	highlightActiveLine,
	highlightActiveLineGutter,
	keymap,
	lineNumbers,
} from "@codemirror/view";
import {useEffect, useRef} from "react";

export interface SourceEditorProps {
	value: string;
	readOnly?: boolean;
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
function readOnlyExtension(readOnly: boolean): Extension {
	return readOnly
		? [EditorState.readOnly.of(true), drawSelection({cursorBlinkRate: 0})]
		: [EditorState.readOnly.of(false), drawSelection()];
}

/** Upstream's code theme (`ͼ3w`, overridden by `ͼo`), in local tokens. */
const sourceEditorTheme = EditorView.theme({
	"&": {
		flex: "1 1 0%",
		minHeight: 0,
		height: "100%",
		backgroundColor: "var(--code-theme-bg, var(--color-surface-1))",
		color: "var(--code-theme-fg, var(--color-primary))",
	},
	"&.cm-focused": {outline: "none"},
	".cm-scroller": {fontFamily: "var(--font-mono)", lineHeight: "inherit", overflow: "auto"},
	".cm-content": {padding: "8px 0"},
	".cm-line": {padding: "0 12px 0 4px"},
	".cm-gutters": {backgroundColor: "inherit", color: "var(--muted-as-secondary)", border: "none"},
	".cm-gutters .cm-lineNumbers .cm-gutterElement": {
		padding: "0 0 0 18px",
		minWidth: "2rem",
		cursor: "default",
		userSelect: "none",
	},
	// Upstream paints rgba(255,255,255,.05) on its dark theme; currentColor keeps light themes legible.
	".cm-activeLine": {backgroundColor: "color-mix(in srgb, currentColor 5%, transparent)"},
	".cm-activeLineGutter": {backgroundColor: "transparent", color: "inherit"},
	".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
		background: "rgba(0,153,255,.3)",
	},
	".cm-selectionMatch": {backgroundColor: "rgba(0,153,255,.14)"},
});

function wrapExtension(wordWrap: boolean): Extension {
	return wordWrap ? EditorView.lineWrapping : [];
}

/** CodeMirror source view shared by the Files viewer and (later) the editable source editors. */
export function SourceEditor({value, readOnly = false, wordWrap = true, tabSize = 4, className}: SourceEditorProps) {
	const hostRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef<EditorView | null>(null);
	const compartments = useRef({
		readOnly: new Compartment(),
		wrap: new Compartment(),
		tabSize: new Compartment(),
	}).current;
	// The mount effect reads the first render's props; later changes go through the effects below.
	const initial = useRef({value, readOnly, wordWrap, tabSize}).current;

	useEffect(() => {
		const parent = hostRef.current;
		if (!parent) return undefined;
		const view = new EditorView({
			parent,
			state: EditorState.create({
				doc: initial.value,
				extensions: [
					lineNumbers(),
					highlightActiveLine(),
					highlightActiveLineGutter(),
					EditorState.allowMultipleSelections.of(true),
					keymap.of(defaultKeymap),
					EditorView.contentAttributes.of({"aria-label": "File contents"}),
					sourceEditorTheme,
					compartments.readOnly.of(readOnlyExtension(initial.readOnly)),
					compartments.wrap.of(wrapExtension(initial.wordWrap)),
					compartments.tabSize.of(EditorState.tabSize.of(initial.tabSize)),
				],
			}),
		});
		viewRef.current = view;
		return () => {
			view.destroy();
			viewRef.current = null;
		};
	}, [compartments, initial]);

	useEffect(() => {
		const view = viewRef.current;
		if (!view || view.state.doc.toString() === value) return;
		view.dispatch({changes: {from: 0, to: view.state.doc.length, insert: value}});
	}, [value]);

	useEffect(() => {
		viewRef.current?.dispatch({effects: compartments.readOnly.reconfigure(readOnlyExtension(readOnly))});
	}, [compartments, readOnly]);

	useEffect(() => {
		viewRef.current?.dispatch({effects: compartments.wrap.reconfigure(wrapExtension(wordWrap))});
	}, [compartments, wordWrap]);

	useEffect(() => {
		viewRef.current?.dispatch({effects: compartments.tabSize.reconfigure(EditorState.tabSize.of(tabSize))});
	}, [compartments, tabSize]);

	return <div ref={hostRef} className={className} />;
}
