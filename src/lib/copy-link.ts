import type {ToastOptions} from "../components/toast-context";
import {writeClipboardText} from "./clipboard";

export type Toast = (options: ToastOptions) => void;

/** Upstream's Copy link: writes the URL, then toasts "Link copied to clipboard." or the retry error. */
export async function copyLink(url: string, toast: Toast): Promise<void>
{
	const copied = await writeClipboardText(url);
	toast(
		copied
			?
				{
					kind: "success",
					message: "Link copied to clipboard.",
				}
			:
				{
					kind: "error",
					message: "Couldn’t copy the link. Try again.",
				},
	);
}
