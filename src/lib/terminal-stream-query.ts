import {z} from "zod";

const ViewportQuerySchema = z.coerce.number().int().positive().max(500);

/**
 * The live terminal socket's query: the viewport plus what to stream, either
 * a Claude session's pane (`sessionId`) or any herdr pane by id (`paneId`),
 * such as a plain shell. Exactly one of the two.
 */
export const TerminalStreamQuerySchema = z
	.object(
		{
			sessionId: z.string().min(1).optional(),
			paneId: z.string().min(1).optional(),
			columns: ViewportQuerySchema,
			rows: ViewportQuerySchema,
		},
	)
	.refine(
		(query) => (query.sessionId === undefined) !== (query.paneId === undefined),
		{
			message: "name exactly one of sessionId and paneId",
		},
	)
	.transform(({sessionId, paneId, columns, rows}) => (
	{
		target:
			paneId === undefined
				?
					{
						kind: "session" as const,
						sessionId: sessionId ?? "",
					}
				:
					{
						kind: "pane" as const,
						paneId,
					},
		columns,
		rows,
	}));
