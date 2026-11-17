import {useQueryClient} from "@tanstack/react-query";
import {useParams, useRouter, type ErrorComponentProps} from "@tanstack/react-router";
import {sessionDetailQueryOptions, transcriptQueryOptions} from "../lib/api/sessions";
import {cdsButtonClass} from "./ui/cds-button";

/**
 * Upstream's EpitaxyChatPanel crash fallback (`XG → fN`). Try again drops this session's cached detail and
 * transcript, like upstream's `vte(id)`/`Ow(id)`, then resets the boundary and re-runs the loader.
 * `h-full` instead of upstream's `min-h-screen` centres it in the pane without overflowing.
 */
export function SessionErrorComponent({reset}: ErrorComponentProps)
{
	const router = useRouter();
	const queryClient = useQueryClient();
	const {id} = useParams(
		{
			strict: false,
		},
	);
	return (
		<div data-session-crash="" className="flex h-full flex-col items-center justify-center px-4">
			<div className="max-w-md text-center">
				<div className="mb-6 text-lg font-medium text-danger">Something went wrong loading this session.</div>
				<button
					type="button"
					onClick={() =>
					{
						if (id !== undefined)
						{
							queryClient.removeQueries(
								{
									queryKey: sessionDetailQueryOptions(id).queryKey,
									exact: true,
								},
							);
							queryClient.removeQueries(
								{
									queryKey: transcriptQueryOptions(id).queryKey,
									exact: true,
								},
							);
						}
						reset();
						void router.invalidate();
					}}
					className={cdsButtonClass("primary")}
				>
					Try again
				</button>
			</div>
		</div>
	);
}
