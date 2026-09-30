import {useQuery} from "@tanstack/react-query";

import {useToast} from "../components/toast";
import {herdrPanesQueryOptions, launchHerdrSession} from "../lib/api/herdr";
import {writeClipboardText} from "../lib/clipboard";
import {forkSession, setPendingFork} from "../lib/session-fork";

/** Fork (menu `f`, ⌥⌘O): launch the fork in herdr, else copy its command. */
export function useSessionFork(): (target: {sessionId: string; cwd: string}) => void {
	const {data: herdr} = useQuery(herdrPanesQueryOptions);
	const toast = useToast();
	const herdrWritable = herdr?.writesEnabled ?? false;
	return (target) => {
		void forkSession(target, {
			herdrWritable,
			launch: (launch) => launchHerdrSession(launch),
			copy: writeClipboardText,
			toast,
			onLaunched: setPendingFork,
			now: Date.now,
		});
	};
}
