import {loopbackOrigin} from "./dev-server-links";

export type DevServerProbe = "live" | "down" | "refused";

const PROBE_TIMEOUT_MS = 1_500;

/**
 * Whether a loopback dev server answers. Only loopback origins are ever
 * requested, so session content cannot turn this into a server-side request
 * to an arbitrary host. Any HTTP response, even an error status, means
 * something is listening; redirects are not followed.
 */
export async function probeDevServer(
	url: string,
	fetchImpl: typeof fetch = fetch,
	timeoutMs = PROBE_TIMEOUT_MS,
): Promise<DevServerProbe> {
	const origin = loopbackOrigin(url);
	if (origin === undefined) return "refused";
	try {
		const response = await fetchImpl(`${origin}/`, {
			method: "HEAD",
			redirect: "manual",
			signal: AbortSignal.timeout(timeoutMs),
		});
		await response.body?.cancel();
		return "live";
	} catch {
		return "down";
	}
}
