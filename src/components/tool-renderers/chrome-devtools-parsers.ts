export interface PageInfo {
	index: number;
	url: string;
	selected: boolean;
}

export function parsePageList(text: string): PageInfo[] {
	const pages: PageInfo[] = [];
	for (const line of text.split("\n")) {
		const m = /^(\d+):\s+(.+?)(\s+\[selected\])?$/.exec(line.trim());
		if (m) {
			pages.push({
				index: parseInt(m[1]!, 10),
				url: m[2]!,
				selected: !!m[3],
			});
		}
	}
	return pages;
}

export interface ConsoleMessage {
	msgid: string;
	level: string;
	message: string;
	argCount?: number;
}

export function parseConsoleMessage(line: string): ConsoleMessage | null {
	const m = /^msgid=(\d+)\s+\[(\w+)\]\s+(.+?)(?:\s+\((\d+)\s+args?\))?$/.exec(line.trim());
	if (!m) return null;
	const result: ConsoleMessage = {
		msgid: m[1]!,
		level: m[2]!,
		message: m[3]!,
	};
	if (m[4]) {
		result.argCount = parseInt(m[4], 10);
	}
	return result;
}

export interface NetworkRequest {
	reqid: string;
	method: string;
	url: string;
	status: string;
	statusCode?: number;
}

export function parseNetworkRequest(line: string): NetworkRequest | null {
	const m = /^reqid=(\d+)\s+(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\S+)\s+\[(\w+)(?:\s*-\s*(\d+))?\]/.exec(
		line.trim(),
	);
	if (!m) return null;
	const result: NetworkRequest = {
		reqid: m[1]!,
		method: m[2]!,
		url: m[3]!,
		status: m[4]!,
	};
	if (m[5]) {
		result.statusCode = parseInt(m[5], 10);
	}
	return result;
}
