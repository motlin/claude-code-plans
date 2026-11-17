import {useQueryClient} from "@tanstack/react-query";
import {lazy, Suspense, useState} from "react";

import
{
	type AutoDefaultOffer,
	type AutoDefaultOfferBody,
	autoDefaultOfferQueryOptions,
	postAutoDefaultOffer,
} from "../../lib/api/auto-default-offer";
import {composerDefaultsQueryOptions} from "../../lib/api/composer-defaults";
import {type AutoDefaultDialog, autoDefaultDialogFor} from "../../lib/auto-default-offer";
import {useToast} from "../toast-context";

// The dialogs and their Base UI Dialog stay off the home page's cold load: almost every visit shows neither.
const AutoDefaultNoticeDialog = lazy(async () =>
	import("./auto-default-dialog-views").then((module) => (
	{
		default: module.AutoDefaultNoticeDialog,
	})),
);
const AutoDefaultNudgeDialog = lazy(async () =>
	import("./auto-default-dialog-views").then((module) => (
	{
		default: module.AutoDefaultNudgeDialog,
	})),
);

/**
 * Upstream's one-shot Auto dialogs on the new-session draft (cc43287c9 `qge` and c4a83c53b `q`), over the CLI's own
 * seen flags. `offer` stays undefined until every input has loaded; the first settled render decides, once per
 * mount, which dialog (if any) this draft shows, so a refetch can't close or swap it mid-view.
 */
export function AutoDefaultOfferDialogs({
	offer,
	folderChoice,
	repoDefaultMode,
	post = postAutoDefaultOffer,
}: {
	offer: AutoDefaultOffer | undefined;
	folderChoice: string | undefined;
	repoDefaultMode: string | null;
	post?: (body: AutoDefaultOfferBody) => Promise<AutoDefaultOffer>;
})
{
	const queryClient = useQueryClient();
	const toast = useToast();
	const [dialog, setDialog] = useState<AutoDefaultDialog | null | undefined>(undefined);
	if (dialog === undefined && offer !== undefined)
	{
		setDialog(
			autoDefaultDialogFor(
				{
					offer,
					folderChoice,
					repoDefaultMode,
				},
			),
		);
	}
	const store = (stored: AutoDefaultOffer) =>
	{
		queryClient.setQueryData(autoDefaultOfferQueryOptions.queryKey, stored);
	};
	if (dialog === undefined || dialog === null) return null;
	if (dialog.kind === "notice")
	{
		return (
			<Suspense fallback={null}>
				<AutoDefaultNoticeDialog
					onShown={() =>
					{
						post(
							{
								surface: "notice",
							},
						)
							.then(store)
							.catch(() =>
							{
								// Not recorded: the CLI or a later visit shows the notice again.
							});
					}}
				/>
			</Suspense>
		);
	}
	return (
		<Suspense fallback={null}>
			<AutoDefaultNudgeDialog
				mode={dialog.mode}
				onAnswer={(choice) =>
				{
					post(
						{
							surface: "nudge",
							choice,
						},
					)
						.then(async (stored) =>
						{
							store(stored);
							if (choice !== "accept") return;
							queryClient.setQueryData(composerDefaultsQueryOptions.queryKey, (defaults) =>
								defaults === undefined
									? defaults
									:
										{
											...defaults,
											defaultMode: "auto",
										},
							);
							await queryClient.invalidateQueries(
								{
									queryKey: composerDefaultsQueryOptions.queryKey,
								},
							);
						})
						.catch(() =>
						{
							if (choice === "accept")
							{
								toast(
									{
										kind: "error",
										message: "Couldn’t update your default permission mode",
									},
								);
							}
						});
				}}
			/>
		</Suspense>
	);
}
