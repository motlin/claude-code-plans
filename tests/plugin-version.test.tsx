// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { PluginVersion } from "../src/components/plugin-version";
import { getPluginVersionKind } from "../src/lib/plugins";

describe("plugin versions", () => {
  it("classifies abbreviated and full commit SHAs separately from releases", () => {
    expect([
      getPluginVersionKind("abcdef1"),
      getPluginVersionKind("abcdef123456"),
      getPluginVersionKind("abcdef123456abcdef123456abcdef123456abcd"),
      getPluginVersionKind("abcdef"),
      getPluginVersionKind("3.1.0"),
    ]).toStrictEqual(["commit", "commit", "commit", "release", "release"]);
  });

  it("renders commits as a short monospace SHA without a version prefix", () => {
    const view = render(
      <PluginVersion version="abcdef123456abcdef123456abcdef123456abcd" versionKind="commit" />,
    );
    const element = view.container.firstElementChild!;

    expect({
      className: element.className,
      tagName: element.tagName,
      textContent: element.textContent,
      title: element.getAttribute("title"),
    }).toStrictEqual({
      className: "font-mono text-xs text-text-500",
      tagName: "CODE",
      textContent: "abcdef123456",
      title: "Pinned to commit abcdef123456abcdef123456abcdef123456abcd",
    });
  });

  it("keeps release versions unchanged", () => {
    const view = render(<PluginVersion version="3.1.0" versionKind="release" />);
    const element = view.container.firstElementChild!;

    expect({
      className: element.className,
      tagName: element.tagName,
      textContent: element.textContent,
      title: element.getAttribute("title"),
    }).toStrictEqual({
      className: "text-xs text-text-500",
      tagName: "SPAN",
      textContent: "v3.1.0",
      title: null,
    });
  });
});
