import {useNavigate} from "@tanstack/react-router";
import {Plus} from "lucide-react";
import {Fragment, useState, type ReactNode} from "react";
import {ARTIFACT_TEMPLATES} from "../../lib/artifact-templates";
import {useFizzyLake} from "../../lib/fizzy-lake";
import {TemplateBadge} from "../make-something-new";
import {TEMPLATE_ICONS} from "../artifact-template-icons";
import {Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger} from "../ui/menu";
import {Tooltip} from "../ui/tooltip";

const LABEL = "New from a template";

/**
 * Upstream's Artifacts row: the nav link plus a hover "+" that opens the "New from a template" menu. Locally a
 * pick opens home with `?create=<slug>`, prefilling the composer with a starter prompt; nothing is sent.
 */
export function ArtifactsNavRow({children}: Readonly<{children: ReactNode}>) {
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	const colorLook = useFizzyLake("color");
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
											colorLook ? (
												// Upstream's fizzy-lake color ArtifactMark at menu size: a bare 20px tinted outline glyph.
												<span
													aria-hidden="true"
													data-artifact-mark={template.markKind}
													data-artifact-mark-size="menu"
													className={`inline-flex size-5 shrink-0 items-center justify-center ${template.glyphClass} [&_svg]:!size-5`}
												>
													<Icon />
												</span>
											) : (
												// Upstream's default ArtifactMark tile; its filled Anthropicons glyph is a bold outline here (anthropicons-glyph-icons).
												<span
													aria-hidden="true"
													data-artifact-mark={template.markKind}
													data-artifact-mark-size="menu"
													className={`inline-flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-[25%] text-white ${template.markClass} [&_svg]:!size-3.5`}
												>
													<Icon strokeWidth={2.25} />
												</span>
											)
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
