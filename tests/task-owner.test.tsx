import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { TaskOwner } from "../src/components/task-owner";

describe("TaskOwner", () => {
  it("renders the owner label", () => {
    expect(renderToStaticMarkup(<TaskOwner owner="alice" />)).toBe(
      '<span class="text-[10px] text-t6" title="Owned by alice">Owner: alice</span>',
    );
  });

  it("renders nothing without an owner", () => {
    expect(renderToStaticMarkup(<TaskOwner owner={null} />)).toBe("");
  });
});
