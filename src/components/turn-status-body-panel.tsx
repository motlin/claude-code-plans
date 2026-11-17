import type {ReactNode} from "react";
import
{
	TURN_STATUS_CARD_CLASS,
	TURN_STATUS_MARKED_PANEL_STYLE,
	TURN_STATUS_PANEL_CLASS,
	TURN_STATUS_PANEL_LEAVING_CLASS,
} from "./turn-status-row-geometry";

/**
 * Upstream shared-9 `Cd`: an open TurnStatus row's body card. While the row is marked (busy or blocked and drawing its
 * leading mark) the body indents under the row label; when the row settles it slides back with the mark.
 */
export function TurnStatusBodyPanel({
	marked,
	leaving,
	className,
	cardClassName,
	children,
}: Readonly<
{
	marked: boolean;
	leaving: boolean;
	className?: string;
	cardClassName?: string | undefined;
	children: ReactNode;
}>)
{
	const panelClass = [className, TURN_STATUS_PANEL_CLASS, leaving && !marked ? TURN_STATUS_PANEL_LEAVING_CLASS : ""]
		.filter((part) => part !== undefined && part !== "")
		.join(" ");
	return (
		<div
			data-turn-status-panel=""
			className={panelClass}
			style={marked ? TURN_STATUS_MARKED_PANEL_STYLE : undefined}
		>
			<div
				className={
					cardClassName === undefined ? TURN_STATUS_CARD_CLASS : `${TURN_STATUS_CARD_CLASS} ${cardClassName}`
				}
			>
				{children}
			</div>
		</div>
	);
}
