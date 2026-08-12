# `just --list --unsorted`
[group('default')]
default:
    @just --list --unsorted

ci := env("CI", "")
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
    PORT={{port}} scripts/server.sh dev vp dev {{args}}

# Build and (re)start the production server in the background. Idempotent: stops any existing server first, so double-starting never leaves an orphan. No launchd service manages this — `just stop` is the only reaper.
start: install build
    PORT={{port}} scripts/server.sh start

# Stop the production server
stop:
    PORT={{port}} scripts/server.sh stop

# Restart the production server without rebuilding
restart:
    PORT={{port}} scripts/server.sh restart

# Show production server status
status:
    PORT={{port}} scripts/server.sh status

# PORT=7527 vp run start
start-preview *args: install build
    PORT={{preview_port}} vp run start {{args}}

# Run linter
lint: install
    vp lint {{ if ci != "" { "--format github" } else { "--fix" } }}

# Run formatter
format: install
    vp fmt {{ if ci != "" { "--check" } else { "" } }}

# Run checks (format + lint + typecheck)
check: install
    vp check {{ if ci != "" { "" } else { "--fix" } }}

[private]
_test *args:
    vp run test:run {{args}}

# Run tests
test *args: install
    just _test {{args}}

# vp run typecheck
typecheck: install
    vp run typecheck

# Build the project
build: install
    vp run build

# Run Storybook dev server
storybook *args: install
    vp run storybook {{args}}

# Regenerate documentation screenshots
[group('docs')]
screenshots *args: install
    vp exec playwright install --with-deps chromium
    vp exec tsx scripts/screenshots.ts {{args}}

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

# Run all pre-commit checks
[arg("quick", long, value="true", help="Skip tests")]
verify quick="": check build fallow pre-commit
    {{ if quick != "true" { "just _test" } else { "true" } }}
    @echo "All pre-commit checks passed!"

# Deprecated alias for `verify`
[arg("quick", long, value="true", help="Skip tests")]
precommit quick="": (verify quick)
