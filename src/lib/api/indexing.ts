import {z} from "zod";

export const IndexingStatusResponse = z.object({
	isIndexing: z.boolean(),
	/** True only while the index is built from empty, when search results are incomplete. */
	isInitialBuild: z.boolean(),
});
