import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MarketplacesEditor,
  ObjectFieldsEditor,
  StringListEditor,
} from "../src/routes/settings_.edit";
import { OBJECT_EDITORS } from "../src/lib/settings-fields";

const noop = () => {};

function editorDef(key: string) {
  const def = OBJECT_EDITORS.find((d) => d.key === key);
  if (!def) throw new Error(`No OBJECT_EDITORS entry for ${key}`);
  return def;
}

describe("settings form editors", () => {
  it("renders sandbox toggle rows via ObjectFieldsEditor", () => {
    const html = renderToStaticMarkup(
      <ObjectFieldsEditor def={editorDef("sandbox")} value={{ enabled: true }} onChange={noop} />,
    );
    expect(html).toContain("Sandbox");
    expect(html).toContain("Enabled");
    expect(html).toContain("Auto-allow Bash if sandboxed");
  });

  it("renders marketplace name and repo via MarketplacesEditor", () => {
    const html = renderToStaticMarkup(
      <MarketplacesEditor
        value={{
          "motlin/claude-code-plugins": {
            source: { source: "github", repo: "motlin/claude-code-plugins" },
          },
        }}
        onChange={noop}
      />,
    );
    expect(html).toContain("motlin/claude-code-plugins");
    expect(html).toContain("Marketplaces");
  });

  it("renders spinnerVerbs verbs list via ObjectFieldsEditor stringList sub-field", () => {
    const html = renderToStaticMarkup(
      <ObjectFieldsEditor
        def={editorDef("spinnerVerbs")}
        value={{ mode: "replace", verbs: ["a", "b"] }}
        onChange={noop}
      />,
    );
    expect(html).toContain("Verbs");
    expect(html).toContain('value="a"');
    expect(html).toContain('value="b"');
  });

  it("renders additionalDirectories entries in StringListEditor", () => {
    const html = renderToStaticMarkup(
      <StringListEditor
        label="Additional directories"
        description=""
        fieldKey="additionalDirectories"
        entries={["/path/to/dir", "/other/dir"]}
        onChange={noop}
        placeholder="/path/to/dir"
      />,
    );
    expect(html).toContain("Additional directories");
    expect(html).toContain('value="/path/to/dir"');
    expect(html).toContain('value="/other/dir"');
  });
});
