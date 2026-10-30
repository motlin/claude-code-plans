import {useQuery} from "@tanstack/react-query";
import {herdrConnectionQueryOptions} from "../lib/api/herdr-connection";

/** Whether the server's herdr subscription is reconnecting; fetched only while `enabled`, pushed over SSE after that. */
export function useHerdrReconnecting(enabled: boolean): boolean {
	const {data} = useQuery({...herdrConnectionQueryOptions, enabled});
	return data?.reconnecting ?? false;
}
