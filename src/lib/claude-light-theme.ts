import type { ThemeRegistrationRaw } from "shiki";

/**
 * Custom Shiki theme matching claude.ai's syntax highlighting colors.
 * Extracted via Chrome DevTools from claude.ai's code blocks.
 */
export const claudeLight: ThemeRegistrationRaw = {
  name: "claude-light",
  type: "light",
  colors: {
    "editor.background": "#faf9f580",
    "editor.foreground": "#141413",
  },
  settings: [
    {
      settings: {
        foreground: "#141413",
      },
    },
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: {
        foreground: "#6E7687",
        fontStyle: "italic",
      },
    },
    {
      scope: [
        "keyword",
        "keyword.control",
        "keyword.operator.new",
        "keyword.operator.expression",
        "keyword.operator.logical",
        "storage.type",
        "storage.modifier",
      ],
      settings: {
        foreground: "#8100C2",
      },
    },
    {
      scope: [
        "entity.name.function",
        "support.function",
        "meta.function-call entity.name.function",
      ],
      settings: {
        foreground: "#0051C2",
      },
    },
    {
      scope: ["string", "string.quoted", "string.template", "punctuation.definition.string"],
      settings: {
        foreground: "#008000",
      },
    },
    {
      scope: [
        "entity.name.type",
        "support.type",
        "support.class",
        "entity.other.inherited-class",
        "meta.type.annotation entity.name.type",
      ],
      settings: {
        foreground: "#B34A00",
      },
    },
    {
      scope: ["constant.numeric", "constant.language"],
      settings: {
        foreground: "#008080",
      },
    },
    {
      scope: ["variable.parameter", "variable.other"],
      settings: {
        foreground: "#141413",
      },
    },
    {
      scope: ["entity.name.tag"],
      settings: {
        foreground: "#8100C2",
      },
    },
    {
      scope: ["entity.other.attribute-name"],
      settings: {
        foreground: "#B34A00",
      },
    },
    {
      scope: ["punctuation", "meta.brace"],
      settings: {
        foreground: "#141413",
      },
    },
    {
      scope: ["keyword.operator", "keyword.operator.assignment"],
      settings: {
        foreground: "#141413",
      },
    },
    {
      scope: ["variable.language.this", "variable.language.self"],
      settings: {
        foreground: "#8100C2",
      },
    },
    {
      scope: ["constant.other", "variable.other.constant"],
      settings: {
        foreground: "#008080",
      },
    },
    {
      scope: ["meta.decorator", "punctuation.decorator"],
      settings: {
        foreground: "#B34A00",
      },
    },
    {
      scope: ["string.regexp"],
      settings: {
        foreground: "#008080",
      },
    },
    {
      scope: ["support.type.property-name", "support.type.property-name.json"],
      settings: {
        foreground: "#0051C2",
      },
    },
    {
      scope: ["markup.heading", "entity.name.section"],
      settings: {
        foreground: "#0051C2",
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
      scope: ["markup.inline.raw"],
      settings: {
        foreground: "#008080",
      },
    },
  ],
};
