import type {ThemeRegistrationRaw} from "shiki";

/**
 * claude.ai/code's Claude Dark code theme (the upstream dark default), as its
 * shared highlighter resolves it. Copied verbatim from
 * .llm/upstream-sync/dumps/code-theme-claude-dark-2026-11-02.json.
 */
export const claudeDark: ThemeRegistrationRaw = {
	name: "claude-dark",
	type: "dark",
	colors: {
		"editor.background": "#191919",
		"editor.foreground": "#eaecf0",
		"editor.selectionBackground": "#0099ff4d",
		"editor.selectionHighlightBackground": "#0099ff24",
		"editor.lineHighlightBackground": "#ffffff0d",
		"editor.findMatchBackground": "#ffd5008c",
		"editor.findMatchForeground": "#000000",
		"editor.findMatchHighlightBackground": "#ffd5002e",
		"editorBracketHighlight.foreground1": "#ffd014",
		"editorBracketHighlight.foreground2": "#f3c0d3",
		"editorBracketHighlight.foreground3": "#3bbd8c",
		"terminal.background": "#191919",
		"terminal.foreground": "#eaecf0",
		"terminal.selectionBackground": "#0099ff4d",
		"terminalCursor.foreground": "#0099ff",
		"terminalCursor.background": "#191919",
		"terminal.ansiBlack": "#262626",
		"terminal.ansiRed": "#ff3a30",
		"terminal.ansiGreen": "#32d74b",
		"terminal.ansiYellow": "#ffd014",
		"terminal.ansiBlue": "#0099ff",
		"terminal.ansiMagenta": "#ff2c56",
		"terminal.ansiCyan": "#b796ff",
		"terminal.ansiWhite": "#a6a6a6",
		"terminal.ansiBrightBlack": "#525252",
		"terminal.ansiBrightRed": "#ff5047",
		"terminal.ansiBrightGreen": "#32d74b",
		"terminal.ansiBrightYellow": "#ffd014",
		"terminal.ansiBrightBlue": "#0087ee",
		"terminal.ansiBrightMagenta": "#ff2c56",
		"terminal.ansiBrightCyan": "#b796ff",
		"terminal.ansiBrightWhite": "#ededed",
	},
	settings: [
		{
			settings: {
				foreground: "#eaecf0",
			},
		},
		{
			scope: ["comment", "punctuation.definition.comment"],
			settings: {
				foreground: "#818898",
			},
		},
		{
			scope: ["punctuation", "meta.brace", "entity.name.namespace"],
			settings: {
				foreground: "#d3d7de",
			},
		},
		{
			scope: ["keyword", "storage", "variable.language"],
			settings: {
				foreground: "#cc7bf4",
			},
		},
		{
			scope: ["keyword.operator"],
			settings: {
				foreground: "#eaecf0",
			},
		},
		{
			scope: [
				"keyword.operator.expression",
				"keyword.operator.new",
				"keyword.operator.word",
				"keyword.operator.logical.python",
			],
			settings: {
				foreground: "#cc7bf4",
			},
		},
		{
			scope: ["string", "punctuation.definition.string"],
			settings: {
				foreground: "#9be963",
			},
		},
		{
			scope: ["string.regexp"],
			settings: {
				foreground: "#96e35f",
			},
		},
		{
			scope: ["constant.numeric", "constant.language", "constant.character", "constant.other.symbol"],
			settings: {
				foreground: "#5eeded",
			},
		},
		{
			scope: ["entity.name.tag", "support.type.property-name", "meta.object-literal.key"],
			settings: {
				foreground: "#f47b85",
			},
		},
		{
			scope: ["entity.other.attribute-name"],
			settings: {
				foreground: "#f0757f",
			},
		},
		{
			scope: ["entity.name.function", "support.function"],
			settings: {
				foreground: "#70b8ff",
			},
		},
		{
			scope: ["variable.parameter"],
			settings: {
				foreground: "#f7ab5f",
			},
		},
		{
			scope: ["variable.other.normal", "punctuation.definition.variable"],
			settings: {
				foreground: "#fbad60",
			},
		},
		{
			scope: [
				"entity.name.type",
				"entity.name.class",
				"entity.other.inherited-class",
				"support.class",
				"support.type",
			],
			settings: {
				foreground: "#fbad60",
			},
		},
		{
			scope: ["markup.deleted"],
			settings: {
				foreground: "#f47b85",
			},
		},
		{
			scope: ["markup.inserted"],
			settings: {
				foreground: "#9be963",
			},
		},
		{
			scope: ["markup.underline.link"],
			settings: {
				foreground: "#5eeded",
			},
		},
		{
			scope: ["keyword.other.important"],
			settings: {
				foreground: "#f47b85",
				fontStyle: "bold",
			},
		},
		{
			scope: [
				"markup.heading",
				"entity.name.section",
				"punctuation.definition.heading.markdown",
				"meta.separator.markdown",
			],
			settings: {
				foreground: "#70b8ff",
				fontStyle: "bold",
			},
		},
		{
			scope: ["markup.bold"],
			settings: {
				fontStyle: "bold",
			},
		},
		{
			scope: ["markup.italic"],
			settings: {
				fontStyle: "italic",
			},
		},
		{
			scope: ["markup.strikethrough"],
			settings: {
				fontStyle: "strikethrough",
			},
		},
		{
			scope: ["markup.inline.raw", "constant.other.reference.link.markdown"],
			settings: {
				foreground: "#9be963",
			},
		},
		{
			scope: [
				"keyword.other.unit",
				"source.css support.constant",
				"constant.other.color",
				"punctuation.definition.constant.css",
				"variable.other.enummember.ts",
				"variable.other.enummember.tsx",
				"variable.other.enummember.js",
				"variable.other.enummember.cpp",
				"variable.other.enummember.swift",
				"constant.other.enum",
				"entity.name.variable.enum-member",
				"constant.other.timestamp",
				"constant.other.date",
			],
			settings: {
				foreground: "#5eeded",
			},
		},
		{
			scope: ["variable.css", "variable.argument.css", "variable.scss"],
			settings: {
				foreground: "#fbad60",
			},
		},
		{
			scope: [
				"keyword.operator.instanceof",
				"keyword.operator.sizeof",
				"keyword.operator.alignof",
				"keyword.operator.typeid",
				"keyword.operator.logical.not.media",
				"keyword.operator.logical.only.media",
				"keyword.operator.logical.and.media",
				"keyword.operator.logical.feature",
				"keyword.operator.logical.scss",
				"keyword.operator.logic.less",
				"keyword.operator.logic.media.less",
				"keyword.operator.logical.lua",
				"keyword.operator.logical.perl",
				"keyword.operator.elixir",
				"keyword.operator.textual",
				"keyword.operator.as",
				"keyword.operator.in",
				"keyword.operator.type.php",
				"keyword.operator.type.asserts",
				"keyword.operator.type-casting",
				"keyword.operator.wordlike",
				"keyword.operator.wordlike keyword.operator",
				"keyword.operator.functionlike keyword.operator",
				"meta.diff.range",
				"punctuation.definition.range.diff",
				"punctuation.definition.list.begin.markdown",
			],
			settings: {
				foreground: "#cc7bf4",
			},
		},
		{
			scope: ["markup.changed", "punctuation.definition.changed.diff"],
			settings: {
				foreground: "#f7ab5f",
			},
		},
		{
			scope: ["punctuation.definition.inserted.diff"],
			settings: {
				foreground: "#9be963",
			},
		},
		{
			scope: ["punctuation.definition.deleted.diff"],
			settings: {
				foreground: "#f47b85",
			},
		},
		{
			scope: ["variable.other.key.toml"],
			settings: {
				foreground: "#f47b85",
			},
		},
		{
			scope: ["source.json invalid.illegal"],
			settings: {
				foreground: "#f47b85",
				fontStyle: "underline",
			},
		},
		{
			scope: [
				"meta.diff",
				"punctuation.definition.from-file.diff",
				"punctuation.definition.to-file.diff",
				"meta.function-call.generic.python",
			],
			settings: {
				foreground: "#70b8ff",
			},
		},
		{
			scope: ["variable.other.alias.yaml"],
			settings: {
				foreground: "#fbad60",
			},
		},
		{
			scope: [
				"meta.template.expression",
				"meta.embedded.line",
				"meta.embedded.interpolation",
				"variable.string-escape.kotlin",
				"string variable.other.php",
				"string variable.other.readwrite.instance.ruby",
				"string variable.other.readwrite.class.ruby",
				"string variable.other.readwrite.global.ruby",
			],
			settings: {
				foreground: "#eaecf0",
			},
		},
		{
			scope: ["variable.other.property", "variable.other.object.property"],
			settings: {
				foreground: "#eaecf0",
			},
		},
	],
	fg: "#eaecf0",
	bg: "#191919",
};
