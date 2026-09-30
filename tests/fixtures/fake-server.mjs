// Minimal HTTP server used by tests/server-lifecycle.test.ts to exercise
// scripts/server.sh without building the real production server.
import {createServer} from "node:http";

// Mirror the real server's process.title rename so the script's default
// SERVER_MATCH is exercised against a renamed command line.
const title = process.env["FAKE_SERVER_TITLE"];
if (title !== undefined) {
	process.title = title;
}

const port = Number(process.env["PORT"] ?? 7581);
const server = createServer((_req, res) => {
	res.end("ok");
});
server.listen(port);
