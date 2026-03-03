# claude-code-plans

HTTP server that renders Claude Code plan files as syntax-highlighted HTML with live-reload via SSE.

## Quick start

```sh
npm install
npm run dev
```

## Configuration

| Variable    | Default            | Description                        |
| ----------- | ------------------ | ---------------------------------- |
| `PORT`      | `8899`             | Port the server listens on         |
| `PLANS_DIR` | `~/.claude/plans`  | Directory containing plan files    |
