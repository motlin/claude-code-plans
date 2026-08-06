// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { SessionDrawer } from "../src/components/session-drawer";

function renderDrawer(onClose = vi.fn()) {
  const view = render(
    <>
      <button type="button">Background action</button>
      <SessionDrawer title="Session files" count={24} onClose={onClose}>
        <div>First resource</div>
        <div>Last resource</div>
      </SessionDrawer>
    </>,
  );

  return { onClose, view };
}

function installPointerCapture(handle: HTMLElement) {
  const capturedPointers = new Set<number>();
  const setPointerCapture = vi.fn((pointerId: number) => capturedPointers.add(pointerId));
  const releasePointerCapture = vi.fn((pointerId: number) => capturedPointers.delete(pointerId));
  const hasPointerCapture = vi.fn((pointerId: number) => capturedPointers.has(pointerId));

  Object.assign(handle, {
    setPointerCapture,
    releasePointerCapture,
    hasPointerCapture,
  });

  return { hasPointerCapture, releasePointerCapture, setPointerCapture };
}

afterEach(() => {
  document.body.style.overflow = "";
});

describe("SessionDrawer", () => {
  it("renders the default width, labelled header, count, and scroll body", () => {
    renderDrawer();

    const drawer = screen.getByRole("complementary", { name: "Session files" });
    const body = screen.getByRole("region", { name: "Session files contents" });

    expect({
      drawerStyle: drawer.getAttribute("style"),
      drawerClasses: drawer.className,
      heading: screen.getByRole("heading", { name: "Session files" }).textContent,
      count: screen.getByLabelText("24 items").textContent,
      bodyClasses: body.className,
      bodyText: body.textContent,
    }).toStrictEqual({
      drawerStyle: "width: 360px;",
      drawerClasses:
        "fixed inset-y-0 right-0 z-40 flex flex-col border-l border-border-300/15 bg-bg-200 text-text-100 shadow-xl",
      heading: "Session files",
      count: "24",
      bodyClasses: "min-h-0 flex-1 overflow-y-auto",
      bodyText: "First resourceLast resource",
    });
  });

  it("resizes from the starting pointer position and clamps to exact boundaries", () => {
    renderDrawer();
    const drawer = screen.getByRole("complementary", { name: "Session files" });
    const handle = screen.getByRole("separator", { name: "Resize session drawer" });
    const pointerCapture = installPointerCapture(handle);

    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 7 });
    fireEvent.pointerMove(handle, { clientX: 300, pointerId: 7 });
    expect({
      drawerWidth: drawer.style.width,
      handleWidth: handle.getAttribute("aria-valuenow"),
      captureCalls: pointerCapture.setPointerCapture.mock.calls,
    }).toStrictEqual({
      drawerWidth: "560px",
      handleWidth: "560",
      captureCalls: [[7]],
    });

    fireEvent.pointerMove(handle, { clientX: -500, pointerId: 7 });
    expect({
      drawerWidth: drawer.style.width,
      handleWidth: handle.getAttribute("aria-valuenow"),
    }).toStrictEqual({ drawerWidth: "720px", handleWidth: "720" });

    fireEvent.pointerMove(handle, { clientX: 1_000, pointerId: 7 });
    expect({
      drawerWidth: drawer.style.width,
      handleWidth: handle.getAttribute("aria-valuenow"),
    }).toStrictEqual({ drawerWidth: "280px", handleWidth: "280" });

    fireEvent.pointerUp(handle, { clientX: 1_000, pointerId: 7 });
    fireEvent.pointerMove(handle, { clientX: 300, pointerId: 7 });
    expect({
      drawerWidth: drawer.style.width,
      releaseCalls: pointerCapture.releasePointerCapture.mock.calls,
      captured: pointerCapture.hasPointerCapture(7),
    }).toStrictEqual({
      drawerWidth: "280px",
      releaseCalls: [[7]],
      captured: false,
    });
  });

  it("releases pointer capture when an active resize unmounts", () => {
    const { view } = renderDrawer();
    const handle = screen.getByRole("separator", { name: "Resize session drawer" });
    const pointerCapture = installPointerCapture(handle);

    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 8 });
    view.unmount();

    expect({
      releaseCalls: pointerCapture.releasePointerCapture.mock.calls,
      captured: pointerCapture.hasPointerCapture(8),
    }).toStrictEqual({ releaseCalls: [[8]], captured: false });
  });

  it("invokes the close action from its labelled button", () => {
    const { onClose } = renderDrawer();

    fireEvent.click(screen.getByRole("button", { name: "Close Session files drawer" }));

    expect(onClose.mock.calls).toStrictEqual([[]]);
  });

  it("does not add modal behavior, a backdrop, body locking, or background interception", () => {
    document.body.style.overflow = "auto";
    const backgroundAction = vi.fn();
    render(
      <>
        <button type="button" onClick={backgroundAction}>
          Background action
        </button>
        <SessionDrawer title="Session files" count={0} onClose={vi.fn()}>
          Drawer content
        </SessionDrawer>
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Background action" }));

    expect({
      backgroundCallCount: backgroundAction.mock.calls.length,
      bodyOverflow: document.body.style.overflow,
      dialogs: screen.queryAllByRole("dialog").length,
      presentationElements: screen.queryAllByRole("presentation").length,
      drawerCount: screen.getAllByRole("complementary").length,
    }).toStrictEqual({
      backgroundCallCount: 1,
      bodyOverflow: "auto",
      dialogs: 0,
      presentationElements: 0,
      drawerCount: 1,
    });
  });
});
