import type {ThemeRegistrationRaw} from "shiki";

/**
 * claude.ai/code's Claude Light code theme (the upstream light default),
 * which upstream builds as `N("claude-light", "light", D, rT)` in c5d464fa3
 * from shared-41's hsl "claude-chat-light" source. Copied verbatim from
 * .llm/upstream-sync/dumps/code-theme-claude-light-port-live-2026-11-10.json.
 */
export const claudeLight: ThemeRegistrationRaw = {
	name: "claude-light",
	type: "light",
	colors: {
		"editor.background": "#ffffff",
		"editor.foreground": "#14181f",
		"editor.selectionBackground": "#0073e640",
		"editor.selectionHighlightBackground": "#0073e61a",
		"editor.lineHighlightBackground": "#1a1a1a0a",
		"editor.findMatchBackground": "#ffd5008c",
		"editor.findMatchForeground": "#000000",
		"editor.findMatchHighlightBackground": "#ffd50040",
		"editorBracketHighlight.foreground1": "#945d00",
		"editorBracketHighlight.foreground2": "#ad3d66",
		"editorBracketHighlight.foreground3": "#0e6e53",
		"terminal.foreground": "#14181f",
		"terminal.selectionBackground": "#0073e640",
		"terminalCursor.foreground": "#0073e6",
		"terminalCursor.background": "#ffffff",
		"terminal.ansiBlack": "#1a1a1a",
		"terminal.ansiRed": "#ff3a30",
		"terminal.ansiGreen": "#1e9e3c",
		"terminal.ansiYellow": "#98801f",
		"terminal.ansiBlue": "#0073e6",
		"terminal.ansiMagenta": "#cd2054",
		"terminal.ansiCyan": "#8e6bd9",
		"terminal.ansiWhite": "#999999",
		"terminal.ansiBrightBlack": "#666666",
		"terminal.ansiBrightRed": "#ff5047",
		"terminal.ansiBrightGreen": "#1e9e3c",
		"terminal.ansiBrightYellow": "#98801f",
		"terminal.ansiBrightBlue": "#0078f0",
		"terminal.ansiBrightMagenta": "#cd2054",
		"terminal.ansiBrightCyan": "#8e6bd9",
		"terminal.ansiBrightWhite": "#d6d6d6",
	},
	settings: [
		{
			settings: {
				foreground: "#14181f",
			},
		},
		{
			scope: ["comment", "punctuation.definition.comment"],
			settings: {
				foreground: "#6e7687",
			},
		},
		{
			scope: ["punctuation", "meta.brace", "entity.name.namespace"],
			settings: {
				foreground: "#2b303b",
			},
		},
		{
			scope: ["keyword", "storage", "variable.language"],
			settings: {
				foreground: "#8100c2",
			},
		},
		{
			scope: ["keyword.operator"],
			settings: {
				foreground: "#14181f",
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
				foreground: "#8100c2",
			},
		},
		{
			scope: ["string", "punctuation.definition.string"],
			settings: {
				foreground: "#008000",
			},
		},
		{
			scope: ["string.regexp"],
			settings: {
				foreground: "#078307",
			},
		},
		{
			scope: ["constant.numeric", "constant.language", "constant.character", "constant.other.symbol"],
			settings: {
				foreground: "#008080",
			},
		},
		{
			scope: ["entity.name.tag", "support.type.property-name", "meta.object-literal.key"],
			settings: {
				foreground: "#b80a18",
			},
		},
		{
			scope: ["entity.other.attribute-name"],
			settings: {
				foreground: "#bd0f1e",
			},
		},
		{
			scope: ["entity.name.function", "support.function"],
			settings: {
				foreground: "#0051c2",
			},
		},
		{
			scope: ["variable.parameter"],
			settings: {
				foreground: "#b84f05",
			},
		},
		{
			scope: ["variable.other.normal", "punctuation.definition.variable"],
			settings: {
				foreground: "#b34a00",
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
				foreground: "#b34a00",
			},
		},
		{
			scope: ["markup.deleted"],
			settings: {
				foreground: "#b80a18",
			},
		},
		{
			scope: ["markup.inserted"],
			settings: {
				foreground: "#008000",
			},
		},
		{
			scope: ["markup.underline.link"],
			settings: {
				foreground: "#008080",
			},
		},
		{
			scope: ["keyword.other.important"],
			settings: {
				foreground: "#b80a18",
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
				foreground: "#0051c2",
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
				foreground: "#008000",
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
				foreground: "#008080",
			},
		},
		{
			scope: ["variable.css", "variable.argument.css", "variable.scss"],
			settings: {
				foreground: "#b34a00",
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
				foreground: "#8100c2",
			},
		},
		{
			scope: ["markup.changed", "punctuation.definition.changed.diff"],
			settings: {
				foreground: "#b84f05",
			},
		},
		{
			scope: ["punctuation.definition.inserted.diff"],
			settings: {
				foreground: "#008000",
			},
		},
		{
			scope: ["punctuation.definition.deleted.diff"],
			settings: {
				foreground: "#b80a18",
			},
		},
		{
			scope: ["variable.other.key.toml"],
			settings: {
				foreground: "#b80a18",
			},
		},
		{
			scope: ["source.json invalid.illegal"],
			settings: {
				foreground: "#b80a18",
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
				foreground: "#0051c2",
			},
		},
		{
			scope: ["variable.other.alias.yaml"],
			settings: {
				foreground: "#b34a00",
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
				foreground: "#14181f",
			},
		},
		{
			scope: ["variable.other.property", "variable.other.object.property"],
			settings: {
				foreground: "#14181f",
			},
		},
	],
	fg: "#14181f",
	bg: "#ffffff",
};
