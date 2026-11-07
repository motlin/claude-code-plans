#!/usr/bin/env python3
"""Capture the Claude Code CLI's permission dialogs as text, for tests/fixtures/permission-screens.ts.

Dev-only, not part of `just verify`. Ported from the permission-dialog-capture-spike
(.llm/upstream-sync/dumps/permission-dialog-capture-spike-*). It drives the CLI in a private
pty (pyte, 100x40) against a fake Messages API served from this process, so it spends no
tokens, and it gives the CLI a fresh CLAUDE_CONFIG_DIR under the OS temp dir with every
HERDR*/TMUX*/CLAUDE*/ANTHROPIC* variable stripped, so the user's hooks, transcripts and
~/.claude.json are never touched. Every dialog is dismissed with Esc.

    uv run --with pyte scripts/capture-permission-screens.py [--claude PATH] [--out FILE] [SCENARIO...]

Writes blocks in the dump format (`==== NAME (CLI x.y.z) — note`, then the screen from the
full-width divider to the last non-blank row), so a CLI bump can be checked by diffing the
blocks against tests/fixtures/permission-screens.ts. `--dry-run` prints the child process's
environment and argv as JSON and exits without starting anything.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import select
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

COLS, ROWS = 100, 40
FAKE_KEY = "sk-ant-api03-capturefake" + "0" * 70 + "AA"
STRIPPED_PREFIXES = ("HERDR", "TMUX", "CLAUDE", "ANTHROPIC")
KEYS = {"down": b"\x1b[B", "up": b"\x1b[A", "enter": b"\r", "esc": b"\x1b", "tab": b"\t", "ctrl+c": b"\x03"}
DIVIDER = "─" * 20
QUESTION = re.compile(r"Do you want to .*\?|Allow this read outside the working directories\?")

HOOK_ASK = json.dumps(
    {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "ask",
            "permissionDecisionReason": "capture hook asks for this",
        }
    }
)


def hook_ask_settings(matcher: str) -> dict:
    return {"hooks": {"PreToolUse": [{"matcher": matcher, "hooks": [{"type": "command", "command": f"echo '{HOOK_ASK}'"}]}]}}


def bash(command: str, description: str) -> dict:
    return {"name": "Bash", "input": {"command": command, "description": description}}


def scenarios(root: str) -> dict[str, dict]:
    """Each scenario: the tool call(s) the fake model makes, CLI flags, settings, and the keys after the dialog shows."""
    cwd = os.path.join(root, "cwd")
    outside = os.path.join(root, "outside", "note.txt")
    edit = {"name": "Edit", "input": {"file_path": os.path.join(cwd, "a.txt"), "old_string": "line two", "new_string": "line 2"}}
    webfetch = [
        {"name": "ToolSearch", "input": {"query": "select:WebFetch", "max_results": 1}},
        {"name": "WebFetch", "input": {"url": "https://example.com/", "prompt": "Summarize"}},
    ]
    full = bash("npm run build", "Build the project")
    return {
        "BASH_FULL": {"tools": [full], "note": "--permission-mode default; Bash `npm run build` (no rules)"},
        "BASH_FULL_FOCUS_PREFIX_ROW": {"tools": [full], "keys": ["down"], "note": "BASH_FULL after one Down"},
        "BASH_FULL_FOCUS_NO": {"tools": [full], "keys": ["down"] * 3, "note": "BASH_FULL after three Downs"},
        "BASH_FULL_NO_INPUT_MODE": {"tools": [full], "keys": ["down"] * 3 + ["tab"], "note": "No focused + Tab"},
        "BASH_FULL_NO_FEEDBACK_TYPED": {
            "tools": [full],
            "keys": ["down"] * 3 + ["tab"],
            "type": "try x",
            "note": "No input row after typing 'try x'",
        },
        "BASH_ASK_RULE": {
            "tools": [full],
            "settings": {"permissions": {"ask": ["Bash(npm run build)"]}},
            "note": 'permissions.ask ["Bash(npm run build)"]',
        },
        "BASH_HOOK_ASK": {"tools": [full], "settings": hook_ask_settings("Bash"), "note": "PreToolUse hook ask"},
        "BASH_UNICODE_WHITESPACE": {
            "tools": [bash("echo hi​", "Say hi with a zero-width space")],
            "note": "Bash `echo hi\\u200b`: persistent row withheld, auto row kept",
        },
        "BASH_COMPOUND_ADD_DIR": {"tools": [bash("cd /tmp && ls | head -3", "List tmp")], "note": "addDirectories row"},
        "BASH_WITHHELD": {
            "tools": [bash("npm run " + "x" * 12000, "Very long command")],
            "note": "Bash `npm run ` + 12000 x: one-time options only",
        },
        "EDIT_ACCEPT_EDITS_ROW": {"tools": [edit], "note": "Edit inside cwd: row 2 wraps"},
        "EDIT_HOOK_ASK": {"tools": [edit], "settings": hook_ask_settings("Edit"), "note": "Edit with PreToolUse hook ask"},
        "WRITE_CREATE": {
            "tools": [{"name": "Write", "input": {"file_path": os.path.join(cwd, "new.txt"), "content": "new file\n"}}],
            "note": "Write new file inside cwd",
        },
        "READ_OUTSIDE_SESSION_DIR": {
            "tools": [{"name": "Read", "input": {"file_path": outside}}],
            "note": "Read outside cwd in default mode",
        },
        "READ_OUTSIDE_AUTO_FIRST_PROMPT": {
            "tools": [{"name": "Read", "input": {"file_path": outside}}],
            "mode": "auto",
            "note": "auto mode, first read outside cwd",
        },
        "WEBFETCH": {"tools": webfetch, "note": "WebFetch https://example.com/: no footer"},
        "WEBFETCH_FOCUS_NO": {"tools": webfetch, "keys": ["down"] * 2, "note": "WebFetch after two Downs"},
    }


class FakeApi:
    """A Messages API that answers the prompt `CAPTURE:<scenario>` with that scenario's tool calls, one per turn."""

    def __init__(self, tools: dict[str, list[dict]]):
        self.tools = tools
        api = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args):
                pass

            def send_json(self, code: int, value: dict) -> None:
                data = json.dumps(value).encode()
                self.send_response(code)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                if self.path.startswith("/v1/models"):
                    return self.send_json(200, {"data": [], "has_more": False})
                self.send_json(404, {"type": "error", "error": {"type": "not_found_error", "message": "nf"}})

            def do_HEAD(self):
                self.send_response(200)
                self.send_header("content-length", "0")
                self.end_headers()

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
                if "count_tokens" in self.path:
                    return self.send_json(200, {"input_tokens": 10})
                if not self.path.startswith("/v1/messages"):
                    return self.send_json(404, {"type": "error", "error": {"type": "not_found_error", "message": "nf"}})
                api.respond(self, body)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def next_tool(self, body: dict) -> dict | None:
        if not body.get("tools"):
            return None
        messages = body.get("messages") or []
        start, sequence = None, None
        for index, message in enumerate(messages):
            if message.get("role") != "user":
                continue
            content = message.get("content")
            texts = [content] if isinstance(content, str) else [b.get("text", "") for b in content or [] if b.get("type") == "text"]
            for name, tools in self.tools.items():
                if any(f"CAPTURE:{name} " in text + " " for text in texts):
                    start, sequence = index, tools
        if sequence is None:
            return None
        results = sum(
            sum(1 for b in m.get("content") if b.get("type") == "tool_result")
            for m in messages[start + 1 :]
            if m.get("role") == "user" and isinstance(m.get("content"), list)
        )
        # CLI 2.1.318 sends a trailing system message; the model's turn follows the last user message.
        non_system = [m for m in messages if m.get("role") != "system"]
        if results < len(sequence) and non_system and non_system[-1].get("role") == "user":
            return sequence[results]
        return None

    def respond(self, handler: BaseHTTPRequestHandler, body: dict) -> None:
        tool = self.next_tool(body)
        message_id = "msg_" + uuid.uuid4().hex[:20]
        model = body.get("model", "claude-x")
        if tool:
            content = [{"type": "tool_use", "id": "toolu_" + uuid.uuid4().hex[:20], "name": tool["name"], "input": tool["input"]}]
            stop = "tool_use"
        else:
            content = [{"type": "text", "text": "ok"}]
            stop = "end_turn"
        usage = {"input_tokens": 1, "output_tokens": 1, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}
        if not body.get("stream"):
            return handler.send_json(
                200,
                {"id": message_id, "type": "message", "role": "assistant", "model": model, "content": content,
                 "stop_reason": stop, "stop_sequence": None, "usage": usage},
            )
        handler.send_response(200)
        handler.send_header("content-type", "text/event-stream")
        handler.send_header("connection", "close")
        handler.end_headers()

        def event(name: str, data: dict) -> None:
            handler.wfile.write(f"event: {name}\ndata: {json.dumps(data)}\n\n".encode())
            handler.wfile.flush()

        event("message_start", {"type": "message_start", "message": {"id": message_id, "type": "message", "role": "assistant",
              "model": model, "content": [], "stop_reason": None, "stop_sequence": None, "usage": usage}})
        for index, block in enumerate(content):
            if block["type"] == "text":
                event("content_block_start", {"type": "content_block_start", "index": index, "content_block": {"type": "text", "text": ""}})
                event("content_block_delta", {"type": "content_block_delta", "index": index, "delta": {"type": "text_delta", "text": block["text"]}})
            else:
                event("content_block_start", {"type": "content_block_start", "index": index,
                      "content_block": {"type": "tool_use", "id": block["id"], "name": block["name"], "input": {}}})
                event("content_block_delta", {"type": "content_block_delta", "index": index,
                      "delta": {"type": "input_json_delta", "partial_json": json.dumps(block["input"])}})
            event("content_block_stop", {"type": "content_block_stop", "index": index})
        event("message_delta", {"type": "message_delta", "delta": {"stop_reason": stop, "stop_sequence": None}, "usage": {"output_tokens": 1}})
        event("message_stop", {"type": "message_stop"})
        handler.close_connection = True


def inside(path: str, parent: str) -> bool:
    path, parent = os.path.realpath(path), os.path.realpath(parent)
    return path == parent or path.startswith(parent + os.sep)


def make_root() -> str:
    """A fresh scratch tree: cfg (the CLI's config dir), cwd (its working dir) and outside (a dir it must ask to read)."""
    root = os.path.realpath(tempfile.mkdtemp(prefix="ccp-permission-screens-"))
    config_dir = os.path.join(root, "cfg")
    if inside(config_dir, os.path.join(os.path.expanduser("~"), ".claude")):
        shutil.rmtree(root)
        sys.exit(f"refusing to run: CLAUDE_CONFIG_DIR {config_dir} is inside ~/.claude")
    cwd = os.path.join(root, "cwd")
    for directory in (config_dir, cwd, os.path.join(root, "outside")):
        os.makedirs(directory)
    with open(os.path.join(cwd, "a.txt"), "w") as file:
        file.write("line one\nline two\n")
    with open(os.path.join(root, "outside", "note.txt"), "w") as file:
        file.write("outside\n")
    with open(os.path.join(config_dir, ".claude.json"), "w") as file:
        json.dump(
            {
                "hasCompletedOnboarding": True,
                "theme": "dark",
                "customApiKeyResponses": {"approved": [FAKE_KEY[-20:]], "rejected": []},
                "projects": {cwd: {"hasTrustDialogAccepted": True}},
            },
            file,
        )
    return root


def child_env(root: str, port: int) -> dict[str, str]:
    env = {key: value for key, value in os.environ.items() if not key.startswith(STRIPPED_PREFIXES)}
    env.update(
        {
            "TERM": "xterm-256color",
            "COLUMNS": str(COLS),
            "LINES": str(ROWS),
            "CLAUDE_CONFIG_DIR": os.path.join(root, "cfg"),
            "ANTHROPIC_BASE_URL": f"http://127.0.0.1:{port}",
            "ANTHROPIC_API_KEY": FAKE_KEY,
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
            "DISABLE_AUTOUPDATER": "1",
            "DISABLE_TELEMETRY": "1",
        }
    )
    return env


def child_argv(claude: str, scenario: dict) -> list[str]:
    settings = scenario.get("settings", {"disableAllHooks": True})
    return [claude, "--strict-mcp-config", "--settings", json.dumps(settings),
            "--permission-mode", scenario.get("mode", "default")]


def dialog_block(lines: list[str]) -> list[str]:
    start = max((i for i, line in enumerate(lines) if line.startswith(DIVIDER)), default=0)
    block = lines[start:]
    while block and not block[-1]:
        block.pop()
    return block


def capture(claude: str, name: str, scenario: dict, root: str, port: int) -> list[str] | None:
    import fcntl
    import pty
    import struct
    import termios

    import pyte

    screen = pyte.Screen(COLS, ROWS)
    stream = pyte.ByteStream(screen)

    def lines() -> list[str]:
        return [line.rstrip() for line in screen.display]

    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(os.path.join(root, "cwd"))
        os.execve(claude, child_argv(claude, scenario), child_env(root, port))
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))

    def pump(seconds: float) -> bool:
        end = time.time() + seconds
        while (remaining := end - time.time()) > 0:
            ready, _, _ = select.select([fd], [], [], min(remaining, 0.05))
            if ready:
                try:
                    data = os.read(fd, 65536)
                except OSError:
                    return False
                if not data:
                    return False
                stream.feed(data)
        return True

    def wait_for(pattern: re.Pattern[str], seconds: float) -> bool:
        end = time.time() + seconds
        while time.time() < end:
            if not pump(0.1):
                return False
            if pattern.search("\n".join(lines())):
                return True
        return False

    try:
        if not wait_for(re.compile(r"❯|>"), 30):
            return None
        pump(1.0)
        os.write(fd, f"CAPTURE:{name} go".encode())
        pump(0.5)
        os.write(fd, KEYS["enter"])
        if not wait_for(QUESTION, 30):
            return None
        pump(0.5)
        for key in scenario.get("keys", []):
            os.write(fd, KEYS[key])
            pump(0.4)
        if "type" in scenario:
            os.write(fd, scenario["type"].encode())
            pump(0.8)
        block = dialog_block(lines())
        os.write(fd, KEYS["esc"])
        pump(0.5)
        return block
    finally:
        for _ in range(3):
            try:
                os.write(fd, KEYS["ctrl+c"])
            except OSError:
                pass
            pump(0.5)
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        os.waitpid(pid, 0)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--claude", default=shutil.which("claude") or "claude", help="the CLI binary (default: claude on PATH)")
    parser.add_argument("--out", help="write the blocks here instead of stdout")
    parser.add_argument("--dry-run", action="store_true", help="print the child environment and argv as JSON and exit")
    parser.add_argument("scenarios", nargs="*", help="scenario names (default: all)")
    args = parser.parse_args()

    root = make_root()
    try:
        catalog = scenarios(root)
        names = args.scenarios or list(catalog)
        unknown = [name for name in names if name not in catalog]
        if unknown:
            parser.error(f"unknown scenarios: {', '.join(unknown)}")
        if args.dry_run:
            print(json.dumps({"env": child_env(root, 0), "argv": child_argv(args.claude, catalog[names[0]])}))
            return 0
        claude = os.path.realpath(args.claude)
        version = subprocess.run([claude, "--version"], capture_output=True, text=True, check=True).stdout.split()[0]
        api = FakeApi({name: scenario["tools"] for name, scenario in catalog.items()})
        out = open(args.out, "w") if args.out else sys.stdout
        failed = []
        for name in names:
            block = capture(claude, name, catalog[name], root, api.port)
            if block is None:
                failed.append(name)
                continue
            text = "\n".join(block).replace(root, "/tmp/spike")
            out.write(f"==== {name} (CLI {version}) — {catalog[name]['note']}\n{text}\n\n")
            out.flush()
        if failed:
            print(f"no dialog for: {', '.join(failed)}", file=sys.stderr)
        return 1 if failed else 0
    finally:
        shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
