import {type RefObject, useLayoutEffect, useRef} from "react";

import {Icon} from "../ui/icon";
import {InfoTip} from "../ui/info-tip";
import {Tooltip} from "../ui/tooltip";
import {hasRowChrome, modifiedName, modifiedSentence, type SettingRowChromeProps} from "./setting-row-chrome-logic";

/*
 * Upstream's settings row chrome (c51ac4bf6 `we`, built by the row binding `Z`): after the row title, a 6px
 * accent dot when the value differs from its default, a scope badge ("Managed", "All devices", "This
 * computer") when needed, and a ghost xxs Reset that fades in on row hover, keyboard focus or a coarse pointer.
 */

/** Upstream's cds Badge `variant="neutral" size="xs"`, in local tokens (as `attachment-tile-classes` BADGE_CLASS). */
const BADGE_CLASS =
	"inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-fill-ghost-hover px-2 align-middle font-sans text-caption font-medium leading-[round(1.25em,1px)] text-secondary";

const DOT_CLASS = "inline-block size-1.5 shrink-0 rounded-full bg-fill-accent";

export const RESET_WRAPPER_CLASS =
	"inline-flex opacity-0 transition-opacity group-hover/setting:opacity-100 has-[:focus-visible]:opacity-100 pointer-coarse:opacity-100";

/** Upstream's cds Button `variant="ghost" size="xxs"`. */
const RESET_BUTTON_CLASS =
	"inline-flex h-5 items-center gap-1 rounded-r4 px-1.5 text-[12px]/[15px] text-primary outline-none hover:bg-alpha-1 focus-visible:bg-alpha-1 focus-visible:shadow-focus";

const FOCUSABLE = "button, input, select, textarea, a[href], [tabindex]";

const TEXT_INPUT_TYPES = new Set(["", "text", "search", "email", "url", "tel", "password", "number"]);

function focusable(element: HTMLElement): boolean
{
	if (element.tabIndex < 0) return false;
	if (element.matches(":disabled, [aria-hidden=true], [hidden]") || element.closest("[inert]") !== null) return false;
	// Upstream counts a text input only on a coarse-pointer-free device (`d(window)`); jumping into a text field
	// from a keyboard Reset would put a phone keyboard up, and is not where upstream lands either.
	if (element instanceof HTMLTextAreaElement) return false;
	if (element instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(element.type)) return false;
	return true;
}

/** Upstream `ve`/`he`/`ge`: the row's own control (checked radio, else first focusable), else the panel. */
function rescueTarget(from: HTMLElement): HTMLElement | null
{
	const row = from.closest<HTMLElement>("[data-settings-row]");
	if (row !== null)
	{
		const control = [...row.querySelectorAll<HTMLElement>("[data-settings-control]")].find(
			(candidate) => candidate.closest("[data-settings-row]") === row,
		);
		if (control !== undefined)
		{
			const radio = control.querySelector<HTMLElement>('[role=radio][aria-checked="true"]');
			if (radio !== null) return radio;
			const first = [...control.querySelectorAll<HTMLElement>(FOCUSABLE)].find(focusable);
			if (first !== undefined) return first;
		}
	}
	return from.closest<HTMLElement>('[tabindex="-1"]');
}

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock"]);

function isFocusVisible(element: Element): boolean
{
	try
	{
		return element.matches(":focus-visible");
	}
	catch
	{
		return false;
	}
}

/**
 * Upstream shared-1 `LO(ref, ve)`: when the Reset span unmounts (the value is back at default) while it holds
 * keyboard focus, focus moves into the row's control instead of falling to the body. A mouse Reset leaves focus.
 */
function useResetFocusRescue(ref: RefObject<HTMLSpanElement | null>)
{
	useLayoutEffect(() =>
	{
		const span = ref.current;
		if (span === null) return undefined;
		let keyboard = false;
		const onFocusIn = (event: FocusEvent) =>
		{
			if (event.target instanceof Element && isFocusVisible(event.target)) keyboard = true;
		};
		const onKeyDown = (event: KeyboardEvent) =>
		{
			if (!MODIFIER_KEYS.has(event.key)) keyboard = true;
		};
		const onPointerDown = () =>
		{
			keyboard = false;
		};
		const onClick = (event: MouseEvent) =>
		{
			keyboard = event.detail === 0;
		};
		span.addEventListener("focusin", onFocusIn);
		span.addEventListener("keydown", onKeyDown);
		span.addEventListener("pointerdown", onPointerDown);
		span.addEventListener("click", onClick);
		return () =>
		{
			span.removeEventListener("focusin", onFocusIn);
			span.removeEventListener("keydown", onKeyDown);
			span.removeEventListener("pointerdown", onPointerDown);
			span.removeEventListener("click", onClick);
			if (!keyboard || !span.contains(document.activeElement)) return;
			const target = rescueTarget(span);
			target?.focus(
				{
					preventScroll: true,
				},
			);
			// The control commits after this row label in the same render, so re-pick once it has (a segmented
			// control's checked radio moves to the default in that commit).
			queueMicrotask(() =>
			{
				const settled = target === null ? null : rescueTarget(target);
				if (settled !== null && document.activeElement !== settled)
					settled.focus(
						{
							preventScroll: true,
						},
					);
			});
		};
	}, [ref]);
}

function ResetButton({
	defaultLabel,
	labelText,
	onReset,
}: {
	defaultLabel: string | undefined;
	labelText: string;
	onReset: () => void;
})
{
	const ref = useRef<HTMLSpanElement>(null);
	useResetFocusRescue(ref);

	return (
		<span ref={ref} className={RESET_WRAPPER_CLASS}>
			<Tooltip content={modifiedSentence(defaultLabel)}>
				<button
					type="button"
					data-cds="Button"
					aria-label={labelText === "" ? "Reset to default" : `Reset ${labelText} to default`}
					className={RESET_BUTTON_CLASS}
					onClick={onReset}
				>
					Reset
				</button>
			</Tooltip>
		</span>
	);
}

/** Upstream `we`: dot, badge, Reset in a 20px strip after the title. */
export function SettingRowChrome(props: SettingRowChromeProps)
{
	const {modified, managed, defaultLabel, labelText, onReset, scopeBadge} = props;
	if (!hasRowChrome(props)) return null;
	const showModified = modified && !managed;

	return (
		<span className="inline-flex h-5 items-center gap-1.5">
			{showModified ? (
				<span
					role="img"
					aria-label={modifiedName(defaultLabel)}
					data-testid="setting-modified-dot"
					className={DOT_CLASS}
				/>
			) : null}
			{managed ? (
				<span data-cds="Badge" className={BADGE_CLASS}>
					Managed
				</span>
			) : scopeBadge === undefined ? null : scopeBadge.scope === "account" ? (
				<span data-cds="Badge" className={BADGE_CLASS}>
					All devices
				</span>
			) : (
				<>
					<span data-cds="Badge" className={BADGE_CLASS}>
						This computer
					</span>
					<InfoTip
						aria-label="More info"
						icon={<Icon name="Info" size="xs" />}
						content={scopeBadge.tooltip}
					/>
				</>
			)}
			{showModified && onReset !== undefined ? (
				<ResetButton defaultLabel={defaultLabel} labelText={labelText} onReset={onReset} />
			) : null}
		</span>
	);
}
