// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { type SidebarDrop, useSidebarDrag } from "../src/hooks/use-sidebar-drag";

function Harness({ onDrop }: { onDrop: (drop: SidebarDrop) => void }) {
  const { drag, rowProps, listRef, zoneRef } = useSidebarDrag({ onDrop });
  return (
    <div>
      <output data-testid="state">{JSON.stringify(drag)}</output>
      <div ref={listRef("pinned")} data-testid="pinned">
        {["a", "b", "c"].map((id) => (
          <div key={id} {...rowProps(id)} data-testid={`row-${id}`}>
            {id}
            <button type="button" data-row-action="">
              menu
            </button>
          </div>
        ))}
      </div>
      <div ref={zoneRef("group-1")} data-testid="zone" />
      <div {...rowProps("x")} data-testid="row-x">
        x
      </div>
    </div>
  );
}

function mockRect(testId: string, top: number, height: number): void {
  const el = screen.getByTestId(testId);
  el.getBoundingClientRect = () =>
    ({
      top,
      bottom: top + height,
      height,
      left: 0,
      right: 200,
      width: 200,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
}

function setup() {
  const onDrop = vi.fn<(drop: SidebarDrop) => void>();
  render(<Harness onDrop={onDrop} />);
  mockRect("row-a", 0, 20);
  mockRect("row-b", 21, 20);
  mockRect("row-c", 42, 20);
  mockRect("pinned", 0, 62);
  mockRect("zone", 100, 20);
  mockRect("row-x", 200, 20);
  return { onDrop };
}

function pointerDown(testId: string, clientY: number): void {
  fireEvent.pointerDown(screen.getByTestId(testId), {
    button: 0,
    pointerId: 1,
    clientX: 50,
    clientY,
  });
}

function pointerMove(clientY: number, clientX = 50): void {
  act(() => {
    fireEvent.pointerMove(window, { pointerId: 1, clientX, clientY });
  });
}

function pointerUp(clientY: number): void {
  act(() => {
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 50, clientY });
  });
}

function sourceRow(id: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`[data-drag-id="${id}"]`);
  if (row === null) {
    throw new Error(`No drag row ${id}`);
  }
  return row;
}

function transforms(): string[] {
  return ["a", "b", "c"].map((id) => sourceRow(id).style.transform);
}

function snapshot() {
  return {
    dragging: document.documentElement.hasAttribute("data-session-dragging"),
    ghosts: document.querySelectorAll("[data-drag-ghost]").length,
    state: JSON.parse(screen.getByTestId("state").textContent ?? "null") as unknown,
  };
}

afterEach(() => {
  cleanup();
});

describe("useSidebarDrag", () => {
  it("treats movement within the 4px threshold as a click", () => {
    const { onDrop } = setup();
    const onClick = vi.fn();
    screen.getByTestId("row-x").addEventListener("click", onClick);

    pointerDown("row-x", 210);
    pointerMove(213);
    expect(snapshot()).toStrictEqual({ dragging: false, ghosts: 0, state: null });
    pointerUp(213);
    fireEvent.click(screen.getByTestId("row-x"));

    expect({ drops: onDrop.mock.calls, clicks: onClick.mock.calls.length }).toStrictEqual({
      drops: [],
      clicks: 1,
    });
  });

  it("drops an outside row into a list slot, shifting the rows below the slot", () => {
    const { onDrop } = setup();

    pointerDown("row-x", 210);
    pointerMove(150);
    expect(snapshot()).toStrictEqual({
      dragging: true,
      ghosts: 1,
      state: { srcId: "x", target: null },
    });
    expect(sourceRow("x").style.visibility).toBe("hidden");

    pointerMove(25);
    expect({ snapshot: snapshot(), transforms: transforms() }).toStrictEqual({
      snapshot: {
        dragging: true,
        ghosts: 1,
        state: { srcId: "x", target: { type: "slot", listId: "pinned", slot: 1 } },
      },
      transforms: ["", "translateY(21px)", "translateY(21px)"],
    });

    pointerUp(25);
    expect({
      drops: onDrop.mock.calls,
      snapshot: snapshot(),
      transforms: transforms(),
      visibility: sourceRow("x").style.visibility,
    }).toStrictEqual({
      drops: [[{ srcId: "x", target: { type: "slot", listId: "pinned", slot: 1 } }]],
      snapshot: { dragging: false, ghosts: 0, state: null },
      transforms: ["", "", ""],
      visibility: "",
    });
  });

  it("reorders within a list and ignores the source's no-op neighbour slots", () => {
    const { onDrop } = setup();

    pointerDown("row-a", 10);
    pointerMove(25);
    expect(snapshot().state).toStrictEqual({ srcId: "a", target: null });

    pointerMove(60);
    expect({ state: snapshot().state, transforms: transforms() }).toStrictEqual({
      state: { srcId: "a", target: { type: "slot", listId: "pinned", slot: 3 } },
      transforms: ["", "translateY(-21px)", "translateY(-21px)"],
    });

    pointerUp(60);
    expect(onDrop.mock.calls).toStrictEqual([
      [{ srcId: "a", target: { type: "slot", listId: "pinned", slot: 3 } }],
    ]);
  });

  it("drops onto a zone element, clearing list shifts", () => {
    const { onDrop } = setup();

    pointerDown("row-x", 210);
    pointerMove(25);
    pointerMove(110);
    expect({ state: snapshot().state, transforms: transforms() }).toStrictEqual({
      state: { srcId: "x", target: { type: "zone", zoneId: "group-1" } },
      transforms: ["", "", ""],
    });

    pointerUp(110);
    expect(onDrop.mock.calls).toStrictEqual([
      [{ srcId: "x", target: { type: "zone", zoneId: "group-1" } }],
    ]);
  });

  it("drops nothing when released away from every target", () => {
    const { onDrop } = setup();

    pointerDown("row-x", 210);
    pointerMove(300);
    pointerUp(300);

    expect({ drops: onDrop.mock.calls, snapshot: snapshot() }).toStrictEqual({
      drops: [],
      snapshot: { dragging: false, ghosts: 0, state: null },
    });
  });

  it("cancels on Escape without dropping", () => {
    const { onDrop } = setup();

    pointerDown("row-x", 210);
    pointerMove(25);
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect({ snapshot: snapshot(), transforms: transforms() }).toStrictEqual({
      snapshot: { dragging: false, ghosts: 0, state: null },
      transforms: ["", "", ""],
    });

    pointerMove(30);
    pointerUp(30);
    expect({ drops: onDrop.mock.calls, snapshot: snapshot() }).toStrictEqual({
      drops: [],
      snapshot: { dragging: false, ghosts: 0, state: null },
    });
  });

  it("suppresses the click that follows a completed drag", () => {
    setup();
    const onClick = vi.fn();
    screen.getByTestId("row-x").addEventListener("click", onClick);

    pointerDown("row-x", 210);
    pointerMove(25);
    pointerUp(25);
    fireEvent.click(screen.getByTestId("row-x"));

    expect(onClick.mock.calls.length).toBe(0);
  });

  it("ignores pointerdown on row actions and non-primary buttons", () => {
    const { onDrop } = setup();
    const [menu] = screen.getAllByText("menu");

    fireEvent.pointerDown(menu!, { button: 0, pointerId: 1, clientX: 50, clientY: 10 });
    pointerMove(60);
    fireEvent.pointerDown(screen.getByTestId("row-x"), {
      button: 2,
      pointerId: 1,
      clientX: 50,
      clientY: 210,
    });
    pointerMove(25);
    pointerUp(25);

    expect({ drops: onDrop.mock.calls, snapshot: snapshot() }).toStrictEqual({
      drops: [],
      snapshot: { dragging: false, ghosts: 0, state: null },
    });
  });
});
