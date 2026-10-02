# `just --list --unsorted`
[group('default')]
default:
    @just --list --unsorted

ci := env("CI", "")

# Every recipe runs the lockfile's vite-plus, not whichever global `vp` the caller's PATH has: a stale global CLI chunks the client build differently and moves the bundle byte ceilings
export PATH := justfile_directory() / "node_modules" / ".bin" + ":" + env("PATH")

port := "7526"
preview_port := "7527"

# Install dependencies
[group('setup')]
install:
    vp install
    just ensure-sqlite-native

# Verify better-sqlite3 native modules match the active Node runtime
[group('setup')]
ensure-sqlite-native:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ ! -d node_modules/.pnpm ]; then
        exit 0
    fi
    find node_modules/.pnpm -path "*/node_modules/better-sqlite3/package.json" -print | sort | while IFS= read -r package_json; do
        package_dir="$PWD/$(dirname "$package_json")"
        if node -e 'const Database = require(process.argv[1]); new Database(":memory:").close();' "$package_dir" >/dev/null 2>&1; then
            continue
        fi
        rm -rf "$package_dir/build"
        pnpm --dir "$package_dir" run build-release
        node -e 'const Database = require(process.argv[1]); new Database(":memory:").close();' "$package_dir"
    done

# Run dev server with Vite
dev *args: install
    PORT={{ port }} scripts/server.sh dev vp dev {{ args }}

# Build and (re)start the production server in the background. Idempotent: stops any existing server first, so double-starting never leaves an orphan. No launchd service manages this — `just stop` is the only reaper.
start: install build
    PORT={{ port }} scripts/server.sh start

# Stop the production server
stop:
    PORT={{ port }} scripts/server.sh stop

# Restart the production server without rebuilding
restart:
    PORT={{ port }} scripts/server.sh restart

# Show production server status
status:
    PORT={{ port }} scripts/server.sh status

# PORT=7527 vp run start
start-preview *args: install build
    PORT={{ preview_port }} vp run start {{ args }}

# Run linter
lint: install
    vp lint {{ if ci != "" { "--format github" } else { "--fix" } }}

# Run formatter
format: install
    pre-commit run just-fmt --all-files
    vp fmt {{ if ci != "" { "--check" } else { "" } }}

# Run checks (format + lint + typecheck)
check *args: install
    vp run --cache check {{ if ci != "" { "" } else { "--fix" } }} {{ args }}

[private]
_test *args:
    vp run --cache test:run {{ args }}

# Run tests
test *args: install
    just _test {{ args }}

# Run the perf suite with the large fixture tier and print a table of the measured counts
[group('perf')]
perf *args: install
    PERF_LARGE=1 vp exec vitest run tests/perf {{ args }}
    vp exec tsx scripts/perf-ceilings.ts --table

# Ratchet the cold-load JS bytes of `/` and `/session/$id` from the client build manifest. Run after `just build`; `just verify` runs it
[group('perf')]
perf-bundle: install
    vp exec tsx scripts/perf-bundle.ts

# Print n and p50/p75/p95 per field metric from the browser's journey samples, split into server/network/client time per build, origin and form factor
[group('perf')]
perf-report *args: install
    vp exec tsx scripts/perf-report.ts {{ args }}

# Count style recalcs, layouts, requests and layout shift for J1–J6 in headless Chromium on a fixture server (:7538). Diagnostic only, never ratcheted
[group('perf')]
perf-lab *args: install
    vp exec tsx scripts/perf-lab.ts {{ args }}

# Run the browser lab 10 times on a fresh fixture server and write per-metric stability to .llm/perf/browser-lab-stability.md
[group('perf')]
perf-lab-stability *args: install
    vp exec tsx scripts/perf-lab-stability.ts {{ args }}

# Time the server lab journeys across the fixture sizes and write Spearman ρ of each lab count against wall time to .llm/perf/correlation.md
[group('perf')]
perf-correlate *args: install
    vp exec tsx scripts/perf-correlate.ts {{ args }}

# Rewrite tests/perf/ceilings.json to lowered and new measured counts. Manual only: never run from CI, a bot or a schedule
[group('perf')]
perf-ceilings: install
    vp exec tsx scripts/perf-ceilings.ts

# Type-check the project
typecheck: install
    vp run --cache typecheck

# Build the project
build: install
    vp run --cache build

# Run Storybook dev server
storybook *args: install
    vp run storybook {{ args }}

# Regenerate documentation screenshots
[group('docs')]
screenshots *args: install
    vp exec playwright install --with-deps chromium
    vp exec tsx scripts/screenshots.ts {{ args }}

# Build static Storybook site
build-storybook: install
    vp run build-storybook

# Apply safe Fallow fixes locally, then reject remaining dead code
fallow: install
    {{ if ci == "" { "vp run fallow" } else { "true" } }}
    vp run fallow:ci

# vp run fallow:ci
fallow-check: install
    vp run fallow:ci

# Run pre-commit hooks on all files (same as CI's pre-commit job)
pre-commit: install
    pre-commit run --all-files

# Audit public singular recipe parameters for documented options
audit-just-options:
    python3 scripts/audit-just-options.py

# Run all pre-commit checks
[arg("quick", long, value="true", help="Skip tests")]
verify quick="": check build perf-bundle fallow pre-commit
    {{ if quick != "true" { "just _test" } else { "true" } }}
    @echo "All pre-commit checks passed!"

# Deprecated alias for `verify`
[arg("quick", long, value="true", help="Skip tests")]
precommit quick="": (verify quick)
