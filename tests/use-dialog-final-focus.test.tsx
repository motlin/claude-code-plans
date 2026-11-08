// @vitest-environment jsdom

import {Dialog} from "@base-ui/react/dialog";
import {Menu} from "@base-ui/react/menu";
import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {type ReactNode, useState} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {type FinalFocus, useDialogFinalFocus} from "../src/components/ui/use-dialog-final-focus";
import {overlayAttrs} from "../src/lib/overlay";
import {registerOpenerReturn} from "../src/lib/overlay-focus";

afterEach(() => {
	cleanup();
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

/** Base UI queues initial focus on a rAF and return focus on a microtask; the parent refocus waits a setTimeout(0). */
async function settle() {
	await act(async () => {
		await new Promise((resolve) => {
			setTimeout(resolve, 30);
		});
	});
}

function HookPopup({label, children}: {label: string; children?: ReactNode}) {
	const {finalFocus, popupRef} = useDialogFinalFocus({open: true});
	return (
		<Dialog.Popup {...overlayAttrs} ref={popupRef} finalFocus={finalFocus} aria-label={label}>
			<button type="button">{`inside ${label}`}</button>
			{children}
		</Dialog.Popup>
	);
}

function Controlled({
	label,
	open,
	onOpenChange,
	children,
}: {
	label: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	children?: ReactNode;
}) {
	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<HookPopup label={label}>{children}</HookPopup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

async function openFrom(button: HTMLElement) {
	button.focus();
	act(() => {
		fireEvent.click(button);
	});
	await settle();
}

function Plain() {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button
				type="button"
				onClick={() => {
					setOpen(true);
				}}
			>
				opener
			</button>
			<input aria-label="field" />
			<Controlled label="A" open={open} onOpenChange={setOpen} />
		</>
	);
}

describe("useDialogFinalFocus (upstream Eo)", () => {
	it("(a) returns focus to the opener on a plain close", async () => {
		render(<Plain />);
		const opener = screen.getByRole("button", {name: "opener"});
		await openFrom(opener);
		expect(document.activeElement).toBe(screen.getByRole("button", {name: "inside A"}));
		act(() => {
			fireEvent.keyDown(document.activeElement ?? document.body, {key: "Escape"});
		});
		await settle();
		expect(document.activeElement).toBe(opener);
	});

	it("(b) hands A's return target to B when A closes with focus in B, then B's close lands on A's opener", async () => {
		let setA: (open: boolean) => void = () => {};
		let setB: (open: boolean) => void = () => {};
		function Stacked() {
			const [a, setAState] = useState(false);
			const [b, setBState] = useState(false);
			setA = setAState;
			setB = setBState;
			return (
				<>
					<button
						type="button"
						onClick={() => {
							setAState(true);
						}}
					>
						opener
					</button>
					<Controlled label="A" open={a} onOpenChange={setAState}>
						<button
							type="button"
							onClick={() => {
								setBState(true);
							}}
						>
							open B
						</button>
					</Controlled>
					<Controlled label="B" open={b} onOpenChange={setBState} />
				</>
			);
		}
		render(<Stacked />);
		const opener = screen.getByRole("button", {name: "opener"});
		await openFrom(opener);
		await openFrom(screen.getByRole("button", {name: "open B"}));
		const insideB = screen.getByRole("button", {name: "inside B"});
		expect(document.activeElement).toBe(insideB);
		act(() => {
			setA(false);
		});
		await settle();
		expect(document.activeElement).toBe(insideB);
		act(() => {
			setB(false);
		});
		await settle();
		expect(document.activeElement).toBe(opener);
	});

	describe("a confirm opened from a menu item inside a parent dialog", () => {
		let setConfirm: (open: boolean) => void = () => {};
		let setThird: (open: boolean) => void = () => {};
		let removeTrigger: () => void = () => {};
		let closeMenu: () => void = () => {};

		function MenuInParent() {
			const [parent, setParent] = useState(false);
			const [confirm, setConfirmState] = useState(false);
			const [third, setThirdState] = useState(false);
			const [trigger, setTrigger] = useState(true);
			const [menu, setMenu] = useState(false);
			closeMenu = () => {
				setMenu(false);
			};
			setConfirm = setConfirmState;
			setThird = setThirdState;
			removeTrigger = () => {
				setTrigger(false);
			};
			return (
				<>
					<button
						type="button"
						onClick={() => {
							setParent(true);
						}}
					>
						settings
					</button>
					<Controlled label="Parent" open={parent} onOpenChange={setParent}>
						{trigger ? (
							<Menu.Root open={menu} onOpenChange={setMenu}>
								<Menu.Trigger>more</Menu.Trigger>
								<Menu.Portal>
									<Menu.Positioner>
										<MenuPopupWithOpener>
											<Menu.Item
												closeOnClick={false}
												onClick={() => {
													setConfirmState(true);
												}}
											>
												Delete
											</Menu.Item>
										</MenuPopupWithOpener>
									</Menu.Positioner>
								</Menu.Portal>
							</Menu.Root>
						) : null}
					</Controlled>
					<Controlled label="Confirm" open={confirm} onOpenChange={setConfirmState} />
					<Controlled label="Third" open={third} onOpenChange={setThirdState} />
				</>
			);
		}

		/** Stands in for task 4's menu registration: the popup's opener is its trigger. */
		function MenuPopupWithOpener({children}: {children: ReactNode}) {
			return (
				<Menu.Popup
					{...overlayAttrs}
					ref={(element) => {
						if (element === null) return;
						registerOpenerReturn(element, () => {
							const trigger = screen.queryByRole("button", {name: "more"});
							return trigger?.isConnected === true ? trigger : null;
						});
					}}
				>
					{children}
				</Menu.Popup>
			);
		}

		async function openConfirmFromMenu() {
			render(<MenuInParent />);
			await openFrom(screen.getByRole("button", {name: "settings"}));
			await openFrom(screen.getByRole("button", {name: "more"}));
			const item = await screen.findByRole("menuitem", {name: "Delete"});
			item.focus();
			act(() => {
				fireEvent.click(item);
			});
			await settle();
			// A browser keeps the item mounted through the menu's exit animation; jsdom has none, so close it after.
			act(() => {
				closeMenu();
			});
			await settle();
			expect(screen.queryByRole("menuitem", {name: "Delete"})).toBe(null);
			expect(document.activeElement).toBe(screen.getByRole("button", {name: "inside Confirm"}));
		}

		it("(c) lands on the menu trigger once the menu item is gone", async () => {
			await openConfirmFromMenu();
			act(() => {
				setConfirm(false);
			});
			await settle();
			expect(document.activeElement).toBe(screen.getByRole("button", {name: "more"}));
		});

		it("(d) falls back to the parent dialog popup when the menu trigger is gone too", async () => {
			await openConfirmFromMenu();
			act(() => {
				removeTrigger();
			});
			act(() => {
				setConfirm(false);
			});
			await settle();
			expect(document.activeElement).toBe(screen.getByRole("dialog", {name: "Parent"}));
		});

		it("(e) defers the parent refocus while a later overlay is open, then refocuses the parent when it closes", async () => {
			await openConfirmFromMenu();
			act(() => {
				removeTrigger();
			});
			act(() => {
				setThird(true);
			});
			await settle();
			const insideThird = screen.getByRole("button", {name: "inside Third"});
			insideThird.focus();
			act(() => {
				setConfirm(false);
			});
			await settle();
			expect(document.activeElement).toBe(insideThird);
			act(() => {
				setThird(false);
			});
			await settle();
			expect(document.activeElement).toBe(screen.getByRole("dialog", {name: "Parent"}));
		});
	});

	it("(f) never steals focus from an outside input", async () => {
		let setOpenOuter: (open: boolean) => void = () => {};
		function WithField() {
			const [open, setOpen] = useState(false);
			setOpenOuter = setOpen;
			return (
				<>
					<button
						type="button"
						onClick={() => {
							setOpen(true);
						}}
					>
						opener
					</button>
					<input aria-label="field" />
					{/* Base UI's modal trap would pull focus back in, so the root is non-modal; the hook stays modal. */}
					<Dialog.Root open={open} onOpenChange={setOpen} modal={false}>
						<Dialog.Portal>
							<HookPopup label="A" />
						</Dialog.Portal>
					</Dialog.Root>
				</>
			);
		}
		render(<WithField />);
		await openFrom(screen.getByRole("button", {name: "opener"}));
		const field = screen.getByRole("textbox", {name: "field"});
		field.focus();
		act(() => {
			setOpenOuter(false);
		});
		await settle();
		expect(document.activeElement).toBe(field);
	});

	it("(g) focuses the opener focus-visibly in the microtask when the holder overlay is gone after a keyboard close", async () => {
		let captured: FinalFocus | undefined;
		function Capture() {
			const {finalFocus, popupRef} = useDialogFinalFocus({open: true});
			captured = finalFocus;
			return (
				<Dialog.Popup {...overlayAttrs} ref={popupRef} finalFocus={false} aria-label="A">
					<button type="button">inside A</button>
				</Dialog.Popup>
			);
		}
		function Host() {
			const [open, setOpen] = useState(false);
			return (
				<>
					<button
						type="button"
						onClick={() => {
							setOpen(true);
						}}
					>
						opener
					</button>
					<Dialog.Root open={open} onOpenChange={setOpen} modal={false}>
						<Dialog.Portal>
							<Capture />
						</Dialog.Portal>
					</Dialog.Root>
				</>
			);
		}
		render(<Host />);
		const opener = screen.getByRole("button", {name: "opener"});
		await openFrom(opener);
		const holder = document.createElement("div");
		holder.setAttribute("data-cds-overlay", "");
		holder.setAttribute("data-open", "");
		const inHolder = document.createElement("button");
		holder.append(inHolder);
		document.body.append(holder);
		inHolder.focus();
		const focus = vi.spyOn(opener, "focus");
		const result = captured?.("keyboard");
		holder.remove();
		await act(async () => {
			await Promise.resolve();
		});
		expect({result, active: document.activeElement, calls: focus.mock.calls}).toStrictEqual({
			result: false,
			active: opener,
			calls: [[{preventScroll: true, focusVisible: true}]],
		});
	});
});
