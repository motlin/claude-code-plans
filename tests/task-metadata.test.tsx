import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { TaskMetadata } from "../src/components/task-metadata";

describe("TaskMetadata", () => {
  it("renders scalar fields and nested objects as key-value pairs", () => {
    const html = renderToStaticMarkup(
      <TaskMetadata
        metadata={{
          commit_sha: "fac216c",
          test_results: ["unit", "typecheck"],
          verification: {
            status: "passed",
            checks: { completed: 12, failed: 0 },
          },
        }}
      />,
    );

    expect(html).toContain("Metadata (3)");
    expect(html).toContain("commit_sha");
    expect(html).toContain("fac216c");
    expect(html).toContain("test_results");
    expect(html).toContain("[&quot;unit&quot;,&quot;typecheck&quot;]");
    expect(html).toContain("verification");
    expect(html).toContain("status");
    expect(html).toContain("passed");
    expect(html).toContain("completed");
    expect(html).toContain("12");
  });

  it("renders nothing for empty metadata", () => {
    expect(renderToStaticMarkup(<TaskMetadata metadata={{}} />)).toBe("");
  });
});
