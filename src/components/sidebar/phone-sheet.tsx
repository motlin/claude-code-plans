import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { shouldClose, swipeIntent } from "../../lib/sheet-swipe";
import { Sidebar } from "./Sidebar";
import { SidebarToggleIcon } from "./primitives";

const PHONE_SHEET_ID = "sidebar-sheet";

/** claude.ai/code's 32x32 "Show sidebar" trigger floating at 8,8 on phones. */
export function PhoneSheetTrigger({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-label="Show sidebar"
      aria-expanded={open}
      aria-controls={PHONE_SHEET_ID}
      onClick={onOpen}
      className="fixed top-2 left-2 z-40 flex h-8 w-8 items-center justify-center rounded-r5 text-primary transition-colors hover:bg-fill-ghost-hover [&_svg]:h-4 [&_svg]:w-4"
    >
      <SidebarToggleIcon />
    </button>
  );
}

interface SwipeStart {
  x: number;
  y: number;
  time: number;
  pointerId: number;
  dragging: boolean;
}

/**
 * The phone sidebar sheet: a full-screen modal dialog that slides in from the left, closes on
 * Escape, navigation, browser Back and a leftward swipe, and moves focus to its Close button.
 */
export function PhoneSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const sheetRef = useRef<HTMLDivElement>(null);
  const swipe = useRef<SwipeStart | null>(null);
  const [drag, setDrag] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    sheetRef.current?.querySelector<HTMLElement>("[data-phone-sheet-close]")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const unsubscribe = router.subscribe("onBeforeNavigate", onClose);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("popstate", onClose);
    window.addEventListener("pagehide", onClose);
    return () => {
      unsubscribe();
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("popstate", onClose);
      window.removeEventListener("pagehide", onClose);
    };
  }, [open, onClose, router]);

  const resetSwipe = () => {
    swipe.current = null;
    setDrag(null);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!open || event.pointerType === "mouse" || !event.isPrimary) return;
    if (event.target instanceof Element && event.target.closest("[data-no-sheet-swipe]")) return;
    swipe.current = {
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp,
      pointerId: event.pointerId,
      dragging: false,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = swipe.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = start.x - event.clientX;
    const dy = event.clientY - start.y;
    if (!start.dragging) {
      const intent = swipeIntent(dx, dy);
      if (intent === "pending") return;
      if (intent === "abandon") {
        swipe.current = null;
        return;
      }
      start.dragging = true;
    }
    setDrag(Math.max(0, dx));
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = swipe.current;
    if (!start || start.pointerId !== event.pointerId) return;
    if (start.dragging) {
      const distance = Math.max(0, start.x - event.clientX);
      const elapsed = Math.max(1, event.timeStamp - start.time);
      const width = sheetRef.current?.getBoundingClientRect().width ?? window.innerWidth;
      if (shouldClose(distance, width, distance / elapsed)) onClose();
    }
    resetSwipe();
  };

  const dragging = drag !== null;

  return (
    <div
      ref={sheetRef}
      id={PHONE_SHEET_ID}
      role="dialog"
      aria-modal="true"
      aria-label="Sidebar"
      tabIndex={-1}
      inert={!open}
      data-open={open ? "" : undefined}
      data-phone-sheet-dragging={dragging ? "" : undefined}
      style={dragging ? ({ "--df-phone-sheet-drag": `${-drag}px` } as CSSProperties) : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={resetSwipe}
      className="phone-sheet"
    >
      <Sidebar collapsed={false} onPhoneSheetClose={onClose} />
    </div>
  );
}
