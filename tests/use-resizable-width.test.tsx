// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { type ResizeEdge, useResizableWidth } from "../src/hooks/use-resizable-width";

function installPointerCapture(handle: HTMLElement) {
  const capturedPointers = new Set<number>();
  Object.assign(handle, {
    setPointerCapture: vi.fn((pointerId: number) => capturedPointers.add(pointerId)),
    releasePointerCapture: vi.fn((pointerId: number) => capturedPointers.delete(pointerId)),
    hasPointerCapture: vi.fn((pointerId: number) => capturedPointers.has(pointerId)),
  });
}

function Harness({
  edge = "end",
  initial = 288,
  onChange,
}: {
  edge?: ResizeEdge;
  initial?: number;
  onChange?: (width: number) => void;
}) {
  const [width, setWidth] = useState(initial);
  const handleProps = useResizableWidth({
    label: "Resize sidebar",
    min: 232,
    max: 420,
    step: 8,
    edge,
    value: width,
    onChange: (next) => {
      setWidth(next);
      onChange?.(next);
    },
  });
  return <div {...handleProps} />;
}

function handleState(handle: HTMLElement) {
  return {
    role: handle.getAttribute("role"),
    orientation: handle.getAttribute("aria-orientation"),
    min: handle.getAttribute("aria-valuemin"),
    max: handle.getAttribute("aria-valuemax"),
    now: handle.getAttribute("aria-valuenow"),
    tabIndex: handle.tabIndex,
  };
}

describe("useResizableWidth", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("exposes separator ARIA props and steps with the arrow keys on the end edge", () => {
    render(<Harness />);
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });

    expect(handleState(handle)).toStrictEqual({
      role: "separator",
      orientation: "vertical",
      min: "232",
      max: "420",
      now: "288",
      tabIndex: 0,
    });

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(handle.getAttribute("aria-valuenow")).toBe("296");

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(handle.getAttribute("aria-valuenow")).toBe("280");

    fireEvent.keyDown(handle, { key: "Home" });
    expect(handle.getAttribute("aria-valuenow")).toBe("232");

    fireEvent.keyDown(handle, { key: "End" });
    expect(handle.getAttribute("aria-valuenow")).toBe("420");

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(handle.getAttribute("aria-valuenow")).toBe("420");
  });

  it("mirrors the arrow keys on the start edge", () => {
    render(<Harness edge="start" />);
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(handle.getAttribute("aria-valuenow")).toBe("296");

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(handle.getAttribute("aria-valuenow")).toBe("280");
  });

  it("clamps a pointer drag to the bounds and reports every width change", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });
    installPointerCapture(handle);

    fireEvent.pointerDown(handle, { clientX: 288, pointerId: 3 });
    fireEvent.pointerMove(handle, { clientX: 338, pointerId: 3 });
    expect(handle.getAttribute("aria-valuenow")).toBe("338");

    fireEvent.pointerMove(handle, { clientX: 2_000, pointerId: 3 });
    expect(handle.getAttribute("aria-valuenow")).toBe("420");

    fireEvent.pointerMove(handle, { clientX: 0, pointerId: 3 });
    expect(handle.getAttribute("aria-valuenow")).toBe("232");

    fireEvent.pointerUp(handle, { clientX: 0, pointerId: 3 });
    fireEvent.pointerMove(handle, { clientX: 300, pointerId: 3 });
    expect(handle.getAttribute("aria-valuenow")).toBe("232");

    expect(onChange.mock.calls).toStrictEqual([[338], [420], [232]]);
  });
});
