import {createContext, useContext} from "react";

import type {ApprovalPresentation} from "../lib/approval-presentation";

/** The session's approval dock: where pending cards draw, and the composer dock's slot (`[data-approval-dock]`). */
export interface ApprovalDock
{
	presentation: ApprovalPresentation;
	dockSlot: HTMLElement | null;
	/** The transcript's pending question, which the session draws in the dock instead of its row while docked. */
	transcriptQuestionId?: string | null;
}

export const ApprovalDockContext = createContext<ApprovalDock | null>(null);

function docked(dock: ApprovalDock | null): boolean
{
	return dock?.presentation === "dock" && dock.dockSlot !== null;
}

/** Whether the session draws this pending question's card in the dock rather than in its transcript row. */
export function useQuestionDocked(toolUseId: string): boolean
{
	const dock = useContext(ApprovalDockContext);
	return docked(dock) && dock?.transcriptQuestionId === toolUseId;
}
