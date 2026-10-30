import {useNavigate} from "@tanstack/react-router";
import {Plus} from "lucide-react";
import {Fragment, useState, type ReactNode} from "react";
import {ARTIFACT_TEMPLATES} from "../../lib/artifact-templates";
import {TemplateBadge, TEMPLATE_ICONS} from "../make-something-new";
import {Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger} from "../ui/menu";
import {Tooltip} from "../ui/tooltip";
import {keepArrowsRoving} from "./use-roving-focus";

const LABEL = "New from a template";

/**
 * Upstream's Artifacts row: the nav link plus a hover "+" that opens the "New from a template" menu. Locally a
 * pick opens home with `?create=<slug>`, prefilling the composer with a starter prompt; nothing is sent.
 */
export function ArtifactsNavRow({children}: Readonly<{children: ReactNode}>) {
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	return (
		<div
			data-row=""
			data-menu-open={open ? "true" : undefined}
			className="group/artifacts-row relative flex items-center data-[menu-open=true]:[&>a]:bg-[var(--sb-hover)]"
		>
			{children}
			<div
				data-row-actions=""
				className={`absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5 transition-opacity group-hover/artifacts-row:pointer-events-auto group-hover/artifacts-row:opacity-100 group-has-[:focus-visible]/artifacts-row:pointer-events-auto group-has-[:focus-visible]/artifacts-row:opacity-100 ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
			>
				<Menu modal={false} onOpenChange={setOpen}>
					<Tooltip content={LABEL} suppressAfterPopup>
						<MenuTrigger
							aria-label={LABEL}
							data-row-action=""
							tabIndex={-1}
							onKeyDown={keepArrowsRoving}
							className="flex size-[var(--sb-row-ctl,24px)] items-center justify-center rounded-r5 text-secondary hover:bg-fill-ghost-hover hover:text-primary aria-expanded:bg-fill-ghost-hover aria-expanded:text-primary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus"
						>
							<Plus aria-hidden="true" className="size-4" />
						</MenuTrigger>
					</Tooltip>
					<MenuContent
						density="comfortable"
						side="right"
						align="start"
						sideOffset={4}
						className="w-[240px]"
						popupProps={{"aria-label": LABEL}}
					>
						{ARTIFACT_TEMPLATES.map((template) => {
							const Icon = TEMPLATE_ICONS[template.slug];
							return (
								<Fragment key={template.slug}>
									{/* Upstream's catalog separates its known types (Docs, Slides, Design) from the rest. */}
									{template.slug === "dashboard" && <MenuSeparator />}
									<MenuItem
										icon={
											<span
												aria-hidden="true"
												data-template-tile=""
												className="inline-flex size-5 items-center justify-center rounded-r4 [&_svg]:!size-4"
												style={{
													background: `color-mix(in srgb, ${template.hue} 16%, transparent)`,
													color: template.hue,
												}}
											>
												<Icon />
											</span>
										}
										onSelect={() => void navigate({to: "/", search: {create: template.slug}})}
									>
										<span className="flex min-w-0 items-center">
											<span className="truncate">{template.label}</span>
											<TemplateBadge badge={template.badge} className="ms-2" />
										</span>
									</MenuItem>
								</Fragment>
							);
						})}
						<MenuSeparator />
						<p className="px-2 pt-1.5 pb-1 text-footnote text-balance text-ink-muted">
							Opens a new session ready to make what you pick. Nothing is created until you send.
						</p>
					</MenuContent>
				</Menu>
			</div>
		</div>
	);
}
