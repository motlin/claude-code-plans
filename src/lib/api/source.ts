import {z} from 'zod';
import {queryOptions} from '@tanstack/react-query';
import {apiFetch} from './client';

export const SourceFileResponse = z
	.object({
		language: z.enum(['markdown', 'json']),
		content: z.string(),
		relativePath: z.string(),
		absolutePath: z.string(),
	})
	.nullable();
export type SourceFileData = z.infer<typeof SourceFileResponse>;

export const sourceFileQueryOptions = (kind: string, relativePath: string) =>
	queryOptions({
		queryKey: ['source', kind, relativePath] as const,
		queryFn: () =>
			apiFetch(
				`/api/source/${encodeURIComponent(kind)}/${relativePath.split('/').map(encodeURIComponent).join('/')}`,
				SourceFileResponse,
			),
		staleTime: Infinity,
		gcTime: Infinity,
	});
