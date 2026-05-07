import {z} from 'zod';

export const IndexingStatusResponse = z.object({
	isIndexing: z.boolean(),
});
