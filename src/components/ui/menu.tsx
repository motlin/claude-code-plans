import { ContextMenu as BaseContextMenu } from "@base-ui/react/context-menu";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import { Check, ChevronRight } from "lucide-react";
import {
  type ComponentProps,
  createContext,
  type KeyboardEvent,
  type ReactNode,
  useContext,
  useRef,
} from "react";

import { useIsMac } from "../../hooks/use-is-mac";
import { toAriaKeyShortcuts } from "../../lib/shortcuts/format";
import { Shortcut } from "./shortcut";

/*
 * One menu primitive copied from claude.ai/code (Base UI Menu / ContextMenu):
 * radius 12 surface with shadow-panel, p-1 scroller, 32px items with px 10 and
 * radius 8, submenus that open on click or ArrowRight only, trailing checks for
 * radio/checkbox items, and single-key accelerators that fire while open.
 */

type MenuKind = "Menu" | "ContextMenu";

const MenuKindContext = createContext<MenuKind>("Menu");

type MenuActionsRef = NonNullable<ComponentProps<typeof BaseMenu.Root>["actionsRef"]>;

/** Closes the enclosing menu; hidden hotkeys need it since they are not Base UI items. */
const MenuCloseContext = createContext<() => void>(() => {});

function useMenuActions(actionsRef: MenuActionsRef | undefined) {
  const ownRef: MenuActionsRef = useRef(null);
  const ref = actionsRef ?? ownRef;
  return { ref, close: () => ref.current?.close() };
}

const POSITIONER_CLASS = "z-[130] outline-none";

const POPUP_CLASS =
  "relative flex max-h-[var(--available-height)] min-w-[128px] max-w-[320px] flex-col rounded-card bg-[var(--menu-bg)] text-body font-normal text-primary shadow-[var(--menu-shadow)] outline-none select-none";

const SCROLLER_CLASS = "min-h-0 overflow-y-auto rounded-[inherit] p-1";

const ITEM_BASE_CLASS =
  "flex w-full cursor-default items-center gap-1 rounded-r6 px-2.5 py-1.5 text-body font-normal outline-none select-none [--shortcut-cap-ink:var(--menu-muted)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

const ITEM_VARIANT_CLASS = {
  default: "text-primary data-[highlighted]:bg-fill-ghost-hover",
  danger:
    "text-danger-100 data-[highlighted]:bg-[var(--menu-danger-fill)] data-[highlighted]:text-[var(--menu-on-danger)] data-[highlighted]:[--shortcut-cap-ink:currentColor]",
} as const;

const SUB_TRIGGER_CLASS = `${ITEM_BASE_CLASS} ${ITEM_VARIANT_CLASS.default} justify-between data-[popup-open]:bg-fill-ghost-hover`;

const LABEL_CLASS = "min-w-0 flex-1 truncate";
const TRAILING_CLASS = "ml-3 flex shrink-0 items-center gap-1";
const CHECK_SLOT_CLASS = "-mr-1 flex size-5 shrink-0 items-center justify-center";

export type MenuItemVariant = keyof typeof ITEM_VARIANT_CLASS;

function isAcceleratorEvent(event: KeyboardEvent<HTMLElement>): boolean {
  return (
    !event.defaultPrevented &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    event.key.length === 1 &&
    event.key !== " "
  );
}

function handleAcceleratorKey(event: KeyboardEvent<HTMLElement>): void {
  if (!isAcceleratorEvent(event)) return;
  const popup = event.currentTarget;
  if (!(event.target instanceof Element) || event.target.closest('[role="menu"]') !== popup) {
    return;
  }
  const key = event.key.toLowerCase();
  const item = Array.from(popup.querySelectorAll<HTMLElement>("[data-accelerator]")).find(
    (candidate) =>
      candidate.dataset["accelerator"] === key &&
      candidate.closest('[role="menu"]') === popup &&
      !candidate.hasAttribute("data-disabled"),
  );
  if (item === undefined) return;
  event.preventDefault();
  event.stopPropagation();
  item.click();
}

function acceleratorProps(accelerator: string | undefined) {
  if (accelerator === undefined) return {};
  const key = accelerator.toLowerCase();
  return { "aria-keyshortcuts": key, "data-accelerator": key };
}

export function Menu({ actionsRef, ...props }: ComponentProps<typeof BaseMenu.Root>) {
  const actions = useMenuActions(actionsRef);
  return (
    <MenuKindContext.Provider value="Menu">
      <MenuCloseContext.Provider value={actions.close}>
        <BaseMenu.Root {...props} actionsRef={actions.ref} />
      </MenuCloseContext.Provider>
    </MenuKindContext.Provider>
  );
}

export const MenuTrigger = BaseMenu.Trigger;

export function ContextMenu({ actionsRef, ...props }: ComponentProps<typeof BaseContextMenu.Root>) {
  const actions = useMenuActions(actionsRef);
  return (
    <MenuKindContext.Provider value="ContextMenu">
      <MenuCloseContext.Provider value={actions.close}>
        <BaseContextMenu.Root {...props} actionsRef={actions.ref} />
      </MenuCloseContext.Provider>
    </MenuKindContext.Provider>
  );
}

export const ContextMenuTrigger = BaseContextMenu.Trigger;

export interface MenuContentProps {
  children: ReactNode;
  side?: ComponentProps<typeof BaseMenu.Positioner>["side"];
  align?: ComponentProps<typeof BaseMenu.Positioner>["align"];
  sideOffset?: number;
  alignOffset?: number;
  className?: string;
  /** Where focus goes when the menu closes; `false` leaves it where an action put it. */
  finalFocus?: ComponentProps<typeof BaseMenu.Popup>["finalFocus"];
}

/** The popup surface. Inside a ContextMenu it opens at the pointer. */
export function MenuContent({
  children,
  side = "bottom",
  align = "start",
  sideOffset = 4,
  alignOffset = 0,
  className,
  finalFocus,
}: MenuContentProps) {
  const kind = useContext(MenuKindContext);
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner
        className={POSITIONER_CLASS}
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
      >
        <BaseMenu.Popup
          data-cds={kind}
          className={className ? `${POPUP_CLASS} ${className}` : POPUP_CLASS}
          onKeyDown={handleAcceleratorKey}
          {...(finalFocus === undefined ? {} : { finalFocus })}
        >
          <div className={SCROLLER_CLASS}>{children}</div>
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

function ItemTrailing({ accelerator, shortcut }: { accelerator?: string; shortcut?: string }) {
  const keys = shortcut ?? accelerator;
  if (keys === undefined) return null;
  return (
    <span aria-hidden="true" className={`${TRAILING_CLASS} pointer-coarse:hidden`}>
      <Shortcut keys={keys} variant="text" />
    </span>
  );
}

function useAriaKeyShortcuts(accelerator?: string, shortcut?: string): string | undefined {
  const isMac = useIsMac();
  if (accelerator !== undefined) return accelerator.toLowerCase();
  if (shortcut !== undefined) return toAriaKeyShortcuts(shortcut, isMac);
  return undefined;
}

export interface MenuItemProps extends Omit<
  ComponentProps<typeof BaseMenu.Item>,
  "onSelect" | "className" | "children"
> {
  children: ReactNode;
  /** Single key that fires this item while the menu is open. */
  accelerator?: string;
  /** Keep the accelerator working but draw no keycap hint. */
  hideAccelerator?: boolean;
  /** Global shortcut hint shown instead of the accelerator, e.g. "alt+cmd+r". */
  shortcut?: string;
  variant?: MenuItemVariant;
  onSelect?: () => void;
}

export function MenuItem({
  children,
  accelerator,
  hideAccelerator = false,
  shortcut,
  variant = "default",
  onSelect,
  ...props
}: MenuItemProps) {
  const ariaKeyShortcuts = useAriaKeyShortcuts(accelerator, shortcut);
  return (
    <BaseMenu.Item
      {...props}
      {...(onSelect ? { onClick: onSelect } : {})}
      {...(ariaKeyShortcuts ? { "aria-keyshortcuts": ariaKeyShortcuts } : {})}
      {...(accelerator ? { "data-accelerator": accelerator.toLowerCase() } : {})}
      data-variant={variant}
      className={`${ITEM_BASE_CLASS} ${ITEM_VARIANT_CLASS[variant]}`}
    >
      <span className={LABEL_CLASS}>{children}</span>
      <ItemTrailing
        {...(accelerator === undefined || hideAccelerator ? {} : { accelerator })}
        {...(shortcut === undefined ? {} : { shortcut })}
      />
    </BaseMenu.Item>
  );
}

/**
 * A single-key action with no visible item: the accelerator handler clicks
 * this hidden node, which runs `onSelect` and closes the menu.
 */
export function MenuHotkey({
  accelerator,
  onSelect,
}: {
  accelerator: string;
  onSelect: () => void;
}) {
  const close = useContext(MenuCloseContext);
  return (
    <span
      hidden
      data-accelerator={accelerator.toLowerCase()}
      onClick={() => {
        onSelect();
        close();
      }}
    />
  );
}

export interface MenuCheckboxItemProps extends Omit<
  ComponentProps<typeof BaseMenu.CheckboxItem>,
  "className" | "children"
> {
  children: ReactNode;
  accelerator?: string;
  /** Global shortcut hint shown before the check, e.g. "ctrl+shift+y". */
  shortcut?: string;
}

export function MenuCheckboxItem({
  children,
  accelerator,
  shortcut,
  ...props
}: MenuCheckboxItemProps) {
  const ariaKeyShortcuts = useAriaKeyShortcuts(accelerator, shortcut);
  return (
    <BaseMenu.CheckboxItem
      closeOnClick={false}
      {...props}
      {...acceleratorProps(accelerator)}
      {...(ariaKeyShortcuts ? { "aria-keyshortcuts": ariaKeyShortcuts } : {})}
      className={`${ITEM_BASE_CLASS} ${ITEM_VARIANT_CLASS.default}`}
    >
      <span className={LABEL_CLASS}>{children}</span>
      {shortcut !== undefined && <ItemTrailing shortcut={shortcut} />}
      <BaseMenu.CheckboxItemIndicator className={CHECK_SLOT_CLASS}>
        <Check aria-hidden="true" className="size-4" />
      </BaseMenu.CheckboxItemIndicator>
    </BaseMenu.CheckboxItem>
  );
}

export const MenuRadioGroup = BaseMenu.RadioGroup;

export interface MenuRadioItemProps extends Omit<
  ComponentProps<typeof BaseMenu.RadioItem>,
  "className" | "children"
> {
  children: ReactNode;
  accelerator?: string;
}

export function MenuRadioItem({ children, accelerator, ...props }: MenuRadioItemProps) {
  return (
    <BaseMenu.RadioItem
      closeOnClick={false}
      {...props}
      {...acceleratorProps(accelerator)}
      className={`${ITEM_BASE_CLASS} ${ITEM_VARIANT_CLASS.default}`}
    >
      <span className={LABEL_CLASS}>{children}</span>
      <BaseMenu.RadioItemIndicator className={CHECK_SLOT_CLASS}>
        <Check aria-hidden="true" className="size-4" />
      </BaseMenu.RadioItemIndicator>
    </BaseMenu.RadioItem>
  );
}

export function MenuSub(props: ComponentProps<typeof BaseMenu.SubmenuRoot>) {
  return <BaseMenu.SubmenuRoot {...props} />;
}

export interface MenuSubTriggerProps extends Omit<
  ComponentProps<typeof BaseMenu.SubmenuTrigger>,
  "className" | "children" | "openOnHover"
> {
  children: ReactNode;
  /** Muted trailing value, e.g. the current radio choice. */
  value?: ReactNode;
  /** Render the trailing value in accent, for non-default choices. */
  valueAccent?: boolean;
}

/** Submenu trigger: opens on click or ArrowRight, never on hover alone. */
export function MenuSubTrigger({ children, value, valueAccent, ...props }: MenuSubTriggerProps) {
  return (
    <BaseMenu.SubmenuTrigger {...props} openOnHover={false} className={SUB_TRIGGER_CLASS}>
      <span className={LABEL_CLASS}>{children}</span>
      <span className={TRAILING_CLASS}>
        {value !== undefined && (
          <span
            data-menu-value=""
            className={
              valueAccent
                ? "max-w-[100px] truncate text-[12px]/[15px] text-accent-100"
                : "text-[12px]/[15px] text-[var(--menu-muted)]"
            }
          >
            {value}
          </span>
        )}
        <ChevronRight
          aria-hidden="true"
          className="-mr-1 size-4 shrink-0 text-[var(--menu-muted)]"
        />
      </span>
    </BaseMenu.SubmenuTrigger>
  );
}

export function MenuSubContent({ children }: { children: ReactNode }) {
  return (
    <MenuContent side="right" align="start" sideOffset={0} alignOffset={-4}>
      {children}
    </MenuContent>
  );
}

export function MenuSeparator() {
  return <BaseMenu.Separator className="mx-2.5 my-1 h-px bg-border" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2.5 pt-1.5 pb-1 text-[12px]/[15px] text-[var(--menu-muted)]">{children}</div>
  );
}
