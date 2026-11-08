import {CatchBoundary} from "@tanstack/react-router";
import {type ComponentProps, Suspense, use} from "react";
import type {SendRejectedCard} from "./send-rejected-card";
import {loadSendRejectedCard} from "./send-rejected-card-loader";

/** use() on a download that tagged itself fulfilled returns synchronously, so a warmed card renders like a static import. */
function CardLoader(props: ComponentProps<typeof SendRejectedCard>) {
	const Card = use(loadSendRejectedCard()).SendRejectedCard;
	return <Card {...props} />;
}

/** {@link SendRejectedCard} behind a dynamic import: nothing renders while it downloads or if the download fails. */
export function LazySendRejectedCard(props: ComponentProps<typeof SendRejectedCard>) {
	return (
		<CatchBoundary getResetKey={() => props.rejection.message} errorComponent={() => null}>
			<Suspense fallback={null}>
				<CardLoader {...props} />
			</Suspense>
		</CatchBoundary>
	);
}
