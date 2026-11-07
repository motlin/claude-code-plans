import {Checkbox} from "@base-ui/react/checkbox";
import {Dialog} from "@base-ui/react/dialog";
import {useNavigate} from "@tanstack/react-router";
import {Check, Ellipsis} from "lucide-react";
import {useRef, useState} from "react";
import {useSetNavSectionPinned} from "../../lib/api/application-settings";
import {useFizzyLake} from "../../lib/fizzy-lake";
import type {NavSection} from "../../lib/nav-sections";
import {useDialogBandBodyClass} from "../ui/dialog-band";
import {DialogHeader} from "../ui/dialog-header";
import {DIALOG_FOOTER_CLASS, useDialogPad} from "../ui/dialog-pad";
import {DialogPopup} from "../ui/dialog-popup";
import {Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger} from "../ui/menu";
import {navItems, type NavItem} from "./navigation";
import type {Section} from "./types";
import {DIALOG_BODY_CLASS} from "../ui/dialog-classes";

export interface NavBadge {
	count: number;
	title: string;
}

const NAV_ROW_CLASS =
	"group df-nav-row h-[var(--sb-row-h)] rounded-[var(--sb-radius)] flex-1 hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent-100),0_0_6px_0_color-mix(in_srgb,var(--color-accent-100)_20%,transparent)] data-[popup-open]:bg-[var(--sb-hover)]";

/**
 * Upstream's sidebar "More" row: a right-side popover listing the nav items that are not pinned,
 * then a separator and "Edit sidebar…", which opens the pin checklist dialog.
 */
export function MoreNavMenu({
	overflow,
	visibleNavSections,
	badgeFor,
	activeSection,
}: {
	overflow: readonly NavItem[];
	visibleNavSections: readonly NavSection[];
	badgeFor: (section: Section) => NavBadge | null;
	/** The page on screen; when it is a More item, the row shows it selected, as upstream does. */
	activeSection?: Section | null;
}) {
	// A session page highlights its own row in the list below, not the More row.
	const active = overflow.find((item) => item.section === activeSection && item.section !== "sessions");
	const navigate = useNavigate();
	const [editing, setEditing] = useState(false);

	return (
		<>
			<div className="flex items-center">
				<Menu>
					<MenuTrigger
						aria-label={active?.label ?? "More navigation items"}
						data-nav-item="more"
						data-row=""
						data-row-nav=""
						data-roving-item=""
						data-selected={active === undefined ? undefined : "focused"}
						className={NAV_ROW_CLASS}
					>
						<span className="df-leading-slot">
							<Ellipsis aria-hidden="true" />
						</span>
						{active === undefined ? (
							<span>More</span>
						) : (
							<span className="truncate flex items-center whitespace-nowrap">{active.label}</span>
						)}
					</MenuTrigger>
					<MenuContent density="comfortable" side="right" align="start">
						{overflow.map((item) => {
							const Icon = item.icon;
							const badge = badgeFor(item.section);
							return (
								<MenuItem
									key={item.section}
									icon={<Icon aria-hidden="true" />}
									onSelect={() => void navigate({to: item.to})}
								>
									<span className="flex min-w-0 items-center">
										<span className="truncate">{item.label}</span>
										{badge !== null && badge.count > 0 && (
											<span
												title={badge.title}
												className="ml-2 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] leading-none font-semibold text-white"
											>
												{badge.count}
											</span>
										)}
									</span>
								</MenuItem>
							);
						})}
						{overflow.length > 0 && <MenuSeparator />}
						{/* Upstream keeps an empty icon slot here so the label lines up with the items above. */}
						<MenuItem
							icon={null}
							onSelect={() => {
								setEditing(true);
							}}
						>
							Edit sidebar…
						</MenuItem>
					</MenuContent>
				</Menu>
			</div>
			<EditSidebarDialog open={editing} onOpenChange={setEditing} visibleNavSections={visibleNavSections} />
		</>
	);
}

/** Upstream's 400px "Edit sidebar" dialog: one checkbox per toggleable nav item, then Done. */
function EditSidebarDialog({
	open,
	onOpenChange,
	visibleNavSections,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	visibleNavSections: readonly NavSection[];
}) {
	const setPinned = useSetNavSectionPinned();
	const visible = new Set(visibleNavSections);
	const panels = useFizzyLake("panels");
	const pad = useDialogPad();
	const bandBody = useDialogBandBodyClass();
	// Upstream `sV`: `initialFocus` is the Done button.
	const doneRef = useRef<HTMLButtonElement>(null);

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Backdrop className="fixed inset-0 z-50 bg-backdrop backdrop-blur-[2px] transition-opacity duration-200 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
				<DialogPopup
					initialFocus={doneRef}
					className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[400px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card bg-surface-3 text-body text-primary shadow-panel-lg outline-none transition-[opacity,scale] duration-200 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none"
				>
					<div className={`${DIALOG_BODY_CLASS} ${pad.p} ${bandBody}`}>
						<DialogHeader
							title="Edit sidebar"
							description="Choose which items appear in your sidebar."
							offHeaderClassName="mb-4 flex items-start gap-2"
							offTitleClassName="text-[17px] leading-6 font-semibold break-words text-primary"
						/>
						<div className={panels ? "flex flex-col" : "mt-2 flex flex-col"}>
							{navItems.map((item) => {
								const Icon = item.icon;
								return (
									<Checkbox.Root
										key={item.section}
										checked={visible.has(item.section)}
										onCheckedChange={(checked) => {
											setPinned(item.section, checked);
										}}
										className="group/cb -mx-2 inline-flex w-auto items-start gap-2 rounded-r6 px-2 py-1 text-left text-body text-primary outline-none hover:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus"
									>
										<span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-r4 border border-strong group-data-[checked]/cb:border-transparent group-data-[checked]/cb:bg-accent-100">
											<Checkbox.Indicator>
												<Check aria-hidden="true" className="size-3 text-white" />
											</Checkbox.Indicator>
										</span>
										<span className="flex items-center gap-2 pl-1">
											<Icon aria-hidden="true" className="size-4 shrink-0 text-secondary" />
											{item.label}
										</span>
									</Checkbox.Root>
								);
							})}
						</div>
						<div className={DIALOG_FOOTER_CLASS}>
							<Dialog.Close
								ref={doneRef}
								className="h-8 rounded-r6 bg-fill-primary px-3 text-body font-medium text-on-primary transition-colors hover:bg-fill-primary-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus"
							>
								Done
							</Dialog.Close>
						</div>
					</div>
				</DialogPopup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
