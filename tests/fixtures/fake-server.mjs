// Minimal HTTP server used by tests/server-lifecycle.test.ts to exercise
// scripts/server.sh without building the real production server.
import { createServer } from "node:http";

const port = Number(process.env["PORT"] ?? 7581);
const server = createServer((_req, res) => {
  res.end("ok");
});
server.listen(port);
