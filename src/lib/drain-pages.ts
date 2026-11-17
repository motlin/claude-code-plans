/** Upstream `Q2`: the most extra pages a fetch-all drain loads. */
export const DRAIN_PAGE_CAP = 40;

/** The parts of an infinite query's `fetchNextPage` result a drain reads. */
export interface DrainResult
{
	hasNextPage: boolean;
	isError: boolean;
	isFetchNextPageError: boolean;
}

function failed(result: DrainResult): boolean
{
	return result.isError || result.isFetchNextPageError;
}

/**
 * Upstream `_K`: fetch the next page once, then keep paging while another page exists, nothing
 * failed and fewer than `cap` pages have loaded. `exhausted` means the feed ran out cleanly; a cap,
 * an error or a throw leaves it false. `hasMore` lets a caller end early once no later page can
 * matter to it (local stand-in for upstream's server-side cutoff).
 */
export async function drainPages<Result extends DrainResult>(
	fetchNextPage: (options: {cancelRefetch: boolean}) => Promise<Result>,
	hasMore: (result: Result) => boolean = (result) => result.hasNextPage,
	cap: number = DRAIN_PAGE_CAP,
): Promise<
{
	exhausted: boolean;
}>
{
	try
	{
		const next = async () =>
			fetchNextPage(
				{
					cancelRefetch: false,
				},
			);
		let result = await next();
		for (let page = 0; hasMore(result) && !failed(result) && page < cap; page++) result = await next();
		return {
			exhausted: !hasMore(result) && !failed(result),
		};
	}
	catch
	{
		return {
			exhausted: false,
		};
	}
}
