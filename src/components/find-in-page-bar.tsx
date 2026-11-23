/**
 * Upstream's in-app Find bar (shared-23 `lT` mount + ⌘F, `sO` bar, `vD` icon button). ⌘F opens it
 * while a find provider is registered (the session transcript registers one); the bar searches the
 * whole page through the find-in-page engine, including transcript entries the virtualized list has
 * not mounted. See .llm/upstream-sync/features/find-in-page-bar.md.
 */

import {useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject} from "react";
import {createPortal} from "react-dom";

import
{
	endFind,
	FIND_PROVIDER_SCOPE_ATTR,
	type FindResult,
	hasFindProviders,
	runFind,
	subscribeFindProviders,
	subscribeFindResults,
} from "../lib/find-in-page/store";
import {isMacPlatform, matchBinding, platformBindings} from "../lib/shortcuts/match";
import {getShortcut} from "../lib/shortcuts/registry";
import {Icon} from "./ui/icon";

/** Upstream `mk`: the search waits this long after the last keystroke. */
const FIND_DEBOUNCE_MS = 120;
/** Upstream `ht`. */
const FIND_BAR_Z_INDEX = 9000;

const BAR_CLASS =
	"fixed end-4 top-14 flex items-center gap-1 rounded-lg border-[0.5px] border-strong bg-surface-popover px-2 py-1.5 shadow-lg";
const INPUT_CLASS =
	"w-48 min-w-0 border-0 bg-transparent outline-none text-body text-primary placeholder:text-ink-muted hide-focus-ring";
const STATUS_CLASS = "whitespace-nowrap text-footnote text-muted-as-secondary tabular-nums";
const BUTTON_CLASS =
	"inline-flex size-6 items-center justify-center rounded text-muted-as-secondary hover:bg-surface-0 hover:text-primary can-focus disabled:pointer-events-none disabled:opacity-40";

/** Upstream `Qt`: the element sits under a modal's `aria-hidden` or `inert` blanket. */
function isBlanketed(element: Element | null): boolean
{
	return element?.closest('[aria-hidden="true"], [inert]') != null;
}

/**
 * Upstream `sK` narrowed to modal layers: a `[role=dialog|alertdialog]` that is `aria-modal`, not
 * hidden and not inside a live region.
 */
function isModalOpen(): boolean
{
	for (const dialog of document.querySelectorAll('[role="dialog"], [role="alertdialog"]'))
	{
		if (dialog.getAttribute("aria-modal") !== "true") continue;
		if (isBlanketed(dialog) || dialog.closest("[hidden], [aria-live]") !== null) continue;
		return true;
	}
	return false;
}

function matchesShortcut(event: KeyboardEvent, id: "find" | "find_next" | "find_prev"): boolean
{
	return platformBindings(getShortcut(id), isMacPlatform()).some((binding) => matchBinding(event, binding));
}

interface OpenState
{
	readonly opener: Element | null;
}

/** Upstream `lT`: mounts the bar on ⌘F (Ctrl+F off mac) while a find provider is registered. */
export function FindInPage(): ReactNode
{
	const enabled = useSyncExternalStore(subscribeFindProviders, hasFindProviders, () => false);
	const [open, setOpen] = useState<OpenState | null>(null);
	const [container, setContainer] = useState<HTMLDivElement | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const isOpen = open !== null;
	if (isOpen && !enabled) setOpen(null);

	useEffect(() =>
	{
		if (!enabled) return undefined;
		const onKeyDown = (event: KeyboardEvent) =>
		{
			if (!matchesShortcut(event, "find") || event.defaultPrevented) return;
			// Stand down to the browser's own find under a modal.
			if (isBlanketed(container) || isModalOpen()) return;
			event.preventDefault();
			if (isOpen)
			{
				inputRef.current?.focus();
				inputRef.current?.select();
				return;
			}
			setOpen(
				{
					opener: document.activeElement,
				},
			);
		};
		window.addEventListener("keydown", onKeyDown);
		return () =>
		{
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [enabled, isOpen, container]);

	const close = useCallback(() =>
	{
		setOpen(null);
	}, []);

	if (typeof document === "undefined") return null;
	return createPortal(
		<div ref={setContainer}>
			{open !== null && <FindInPageBar inputRef={inputRef} opener={open.opener} onClose={close} />}
		</div>,
		document.body,
	);
}

type CloseVia = "escape" | "button" | "overlay" | "iframe_blur" | "auto";

const EMPTY: FindResult =
{
	activeIndex: 0,
	total: 0,
};

/** Upstream `sO`. */
function FindInPageBar({
	inputRef,
	opener,
	onClose,
}: {
	inputRef: RefObject<HTMLInputElement | null>;
	opener: Element | null;
	onClose: () => void;
})
{
	const [query, setQuery] = useState("");
	const [result, setResult] = useState<FindResult>(EMPTY);
	/** Upstream `l`: starts true (`Zt(!0)`) so status stays "" until the first search resolves; later, a new query waiting on the transcript paging in its earlier history. */
	const [loading, setLoading] = useState(true);
	const loadTokenRef = useRef(0);
	const barRef = useRef<HTMLDivElement>(null);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const composingRef = useRef(false);
	const closedRef = useRef(false);
	const searchedRef = useRef<string | null>(null);

	/** Upstream `x`: tear down once; give focus back to the opener only when it was inside the bar. */
	const finish = useCallback(
		(_via: CloseVia, returnFocus: boolean) =>
		{
			if (closedRef.current) return;
			closedRef.current = true;
			clearTimeout(debounceRef.current);
			endFind();
			if (returnFocus && opener instanceof HTMLElement && document.contains(opener))
			{
				opener.focus(
					{
						preventScroll: true,
					},
				);
			}
		},
		[opener],
	);
	const close = useCallback(
		(via: CloseVia, returnFocus = true) =>
		{
			onClose();
			finish(via, returnFocus);
		},
		[onClose, finish],
	);

	/** Upstream `z`: run the search for `value`, as a new query or a step. */
	const search = useCallback((value: string, forward: boolean, isNewQuery: boolean) =>
	{
		if (closedRef.current) return;
		clearTimeout(debounceRef.current);
		const token = ++loadTokenRef.current;
		setLoading(false);
		if (value === "")
		{
			setResult(EMPTY);
			searchedRef.current = null;
			endFind();
			return;
		}
		const {settled, ...next} = runFind(value, forward, isNewQuery || value !== searchedRef.current);
		searchedRef.current = value;
		setResult(next);
		if (settled === undefined) return;
		setLoading(true);
		void settled.then((landed) =>
		{
			if (token !== loadTokenRef.current || closedRef.current) return;
			setLoading(false);
			if (landed !== null) setResult(landed);
		});
	}, []);
	const step = useCallback(
		(forward: boolean) =>
		{
			search(query, forward, false);
		},
		[query, search],
	);

	// Mount: focus and select; unmount closes as "auto", returning focus only from inside the bar.
	useEffect(() =>
	{
		closedRef.current = false;
		inputRef.current?.focus();
		inputRef.current?.select();
		const bar = barRef.current;
		return () =>
		{
			finish("auto", bar?.contains(bar.ownerDocument.activeElement) ?? false);
		};
	}, [inputRef, finish]);

	// Escape anywhere closes the bar, unless something else already handled it.
	useEffect(() =>
	{
		const onKeyDown = (event: KeyboardEvent) =>
		{
			if (event.key !== "Escape" || event.isComposing || event.repeat || event.defaultPrevented) return;
			event.preventDefault();
			const bar = barRef.current;
			close("escape", bar?.contains(document.activeElement) ?? false);
		};
		window.addEventListener("keydown", onKeyDown);
		return () =>
		{
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [close]);

	// The bar's own Escape stops there, so page-level Escape handlers never see it.
	useEffect(() =>
	{
		const bar = barRef.current;
		if (!bar) return undefined;
		const onKeyDown = (event: KeyboardEvent) =>
		{
			if (closedRef.current || event.defaultPrevented || event.key !== "Escape") return;
			event.stopPropagation();
			if (event.isComposing) return;
			event.preventDefault();
			close("escape");
		};
		bar.addEventListener("keydown", onKeyDown);
		return () =>
		{
			bar.removeEventListener("keydown", onKeyDown);
		};
	}, [close]);

	// A dialog opening over the page closes the bar and leaves focus in the dialog.
	useEffect(() =>
	{
		const bar = barRef.current;
		if (!bar) return undefined;
		const check = () =>
		{
			if (
				(isBlanketed(bar) && document.querySelector('[role="dialog"], [role="alertdialog"]') !== null) ||
				isModalOpen()
			)
			{
				observer.disconnect();
				close("overlay", false);
			}
		};
		const observer = new MutationObserver(check);
		for (let element: Element | null = bar; element !== null; element = element.parentElement)
		{
			observer.observe(
				element,
				{
					attributes: true,
					attributeFilter: ["aria-hidden", "inert"],
					childList: element === document.body,
				},
			);
		}
		check();
		return () =>
		{
			observer.disconnect();
		};
	}, [close]);

	// Focus moving into an iframe closes the bar where focus is.
	useEffect(() =>
	{
		let timer: ReturnType<typeof setTimeout> | undefined;
		const onBlur = () =>
		{
			clearTimeout(timer);
			timer = setTimeout(() =>
			{
				if (document.activeElement instanceof HTMLIFrameElement) close("iframe_blur", false);
			}, 0);
		};
		window.addEventListener("blur", onBlur);
		return () =>
		{
			clearTimeout(timer);
			window.removeEventListener("blur", onBlur);
		};
	}, [close]);

	// Live recounts while the page's text changes.
	useEffect(
		() =>
			subscribeFindResults((next) =>
			{
				if (closedRef.current) return;
				setResult((current) =>
					current.activeIndex === next.activeIndex && current.total === next.total ? current : next,
				);
			}),
		[],
	);

	// ⌘G / ⇧⌘G (Ctrl+G off mac), and F3 / ⇧F3 on every platform, step from anywhere.
	useEffect(() =>
	{
		const onKeyDown = (event: KeyboardEvent) =>
		{
			if (event.defaultPrevented || event.isComposing || event.altKey) return;
			const f3 = event.key === "F3" && !event.metaKey && !event.ctrlKey;
			if (!f3 && !matchesShortcut(event, "find_next") && !matchesShortcut(event, "find_prev")) return;
			if (isBlanketed(barRef.current)) return;
			event.preventDefault();
			step(!event.shiftKey);
		};
		window.addEventListener("keydown", onKeyDown);
		return () =>
		{
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [step]);

	const scheduleSearch = (value: string) =>
	{
		setQuery(value);
		clearTimeout(debounceRef.current);
		if (composingRef.current) return;
		debounceRef.current = setTimeout(() =>
		{
			search(value, true, true);
		}, FIND_DEBOUNCE_MS);
	};

	const canStep = !loading && result.total > 0;
	const statusText = query.length === 0 || loading ? "" : canStep ? `${result.activeIndex}/${result.total}` : "0/0";
	return (
		<div
			ref={barRef}
			role="search"
			tabIndex={-1}
			{...
			{
				[FIND_PROVIDER_SCOPE_ATTR]: "",
			}}
			data-find-in-page-bar=""
			className={BAR_CLASS}
			style={
			{
				zIndex: FIND_BAR_Z_INDEX,
			}}
		>
			<input
				ref={inputRef}
				value={query}
				onChange={(event) =>
				{
					if (closedRef.current) return;
					scheduleSearch(event.target.value);
				}}
				onKeyDown={(event) =>
				{
					if (closedRef.current || event.nativeEvent.isComposing || event.key !== "Enter") return;
					event.preventDefault();
					step(!event.shiftKey);
				}}
				onCompositionStart={() =>
				{
					composingRef.current = true;
				}}
				onCompositionEnd={(event) =>
				{
					composingRef.current = false;
					if (closedRef.current) return;
					scheduleSearch(event.currentTarget.value);
				}}
				spellCheck={false}
				autoComplete="off"
				aria-label="Find"
				placeholder="Find…"
				className={INPUT_CLASS}
			/>
			<span role="status" aria-atomic="true" className={STATUS_CLASS}>
				{statusText}
			</span>
			<FindBarButton
				label="Go to previous match"
				disabled={!canStep}
				onClick={() =>
				{
					if (!composingRef.current) step(false);
				}}
			>
				<Icon name="CaretUp" size="sm" />
			</FindBarButton>
			<FindBarButton
				label="Go to next match"
				disabled={!canStep}
				onClick={() =>
				{
					if (!composingRef.current) step(true);
				}}
			>
				<Icon name="CaretDown" size="sm" />
			</FindBarButton>
			<FindBarButton
				label="Close find bar"
				onClick={() =>
				{
					close("button");
				}}
			>
				<Icon name="X" size="sm" />
			</FindBarButton>
		</div>
	);
}

/** Upstream `vD`. */
function FindBarButton({
	label,
	disabled = false,
	onClick,
	children,
}: {
	label: string;
	disabled?: boolean;
	onClick: () => void;
	children: ReactNode;
})
{
	return (
		<button type="button" aria-label={label} onClick={onClick} disabled={disabled} className={BUTTON_CLASS}>
			{children}
		</button>
	);
}
