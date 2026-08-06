// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { StatusDot } from "../src/components/sidebar/primitives/StatusDot";

function statusDotClasses(heat?: "" | "warm" | "hot") {
  const view = render(heat === undefined ? <StatusDot active /> : <StatusDot active heat={heat} />);
  return [...view.container.querySelectorAll("span")].map(({ className }) => className);
}

describe("StatusDot", () => {
  it("keeps the existing active colour when heat is omitted", () => {
    expect(statusDotClasses()).toStrictEqual([
      "relative flex h-2.5 w-2.5 shrink-0",
      "absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75",
      "relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500",
    ]);
  });

  it("escalates warm and hot active dots", () => {
    expect({ warm: statusDotClasses("warm"), hot: statusDotClasses("hot") }).toStrictEqual({
      warm: [
        "relative flex h-2.5 w-2.5 shrink-0",
        "absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75",
        "relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500",
      ],
      hot: [
        "relative flex h-2.5 w-2.5 shrink-0",
        "absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75",
        "relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500",
      ],
    });
  });
});
