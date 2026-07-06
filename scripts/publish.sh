#!/usr/bin/env bash
# Publish the @reley/* packages to npm in dependency order.
#
# Usage:
#   scripts/publish.sh                    # publish current versions, public, no tag
#   scripts/publish.sh --tag next         # publish under dist-tag `next` (beta releases)
#   scripts/publish.sh --dry-run          # show what would happen, no side effects
#   scripts/publish.sh --otp 123456       # pass npm 2FA code
#   scripts/publish.sh --skip-tests       # skip the test gate (not recommended)
#
# Requires NPM_TOKEN in env OR a logged-in `npm whoami`.
# pnpm rewrites `workspace:*` deps to concrete versions at pack time.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DRY_RUN=0
DIST_TAG="latest"
OTP=""
SKIP_TESTS=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)   DRY_RUN=1; shift ;;
    --tag)       DIST_TAG="$2"; shift 2 ;;
    --otp)       OTP="$2"; shift 2 ;;
    --skip-tests) SKIP_TESTS=1; shift ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done

# ------------------------------------------------------------------------------
# Gates: clean tree, on a tag-shaped commit, logged in, build green
# ------------------------------------------------------------------------------

if [[ "$DRY_RUN" -eq 0 ]]; then
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "✗ working tree dirty. commit or stash first." >&2
    exit 1
  fi
  if [[ -z "${NPM_TOKEN:-}" ]] && ! npm whoami >/dev/null 2>&1; then
    echo "✗ not logged into npm. run 'npm login' or set NPM_TOKEN." >&2
    exit 1
  fi
fi

VERSION="$(node -p "require('./package.json').version")"
echo "▸ release version v${VERSION} → dist-tag '${DIST_TAG}'"

# ------------------------------------------------------------------------------
# Clean, install, build, lint, test
# ------------------------------------------------------------------------------

echo "▸ clean + install"
pnpm clean
pnpm install --frozen-lockfile

echo "▸ build (all workspaces)"
pnpm build

echo "▸ lint"
pnpm lint

if [[ "$SKIP_TESTS" -eq 0 ]]; then
  echo "▸ test"
  pnpm test
else
  echo "⚠ skipping tests (--skip-tests)"
fi

# ------------------------------------------------------------------------------
# Publish in dep order: shared → core → core-cli
# ------------------------------------------------------------------------------

PACKAGES=(packages/shared packages/core packages/core-cli)

publish_one() {
  local dir="$1"
  local name
  name="$(node -p "require('./${dir}/package.json').name")"
  local ver
  ver="$(node -p "require('./${dir}/package.json').version")"
  local is_private
  is_private="$(node -p "Boolean(require('./${dir}/package.json').private)")"

  if [[ "$is_private" == "true" ]]; then
    echo "✗ ${name} is marked private. flip package.json \`private\` to false to publish." >&2
    exit 1
  fi

  echo "▸ publish ${name}@${ver}"
  local args=(publish --access public --tag "$DIST_TAG" --no-git-checks)
  if [[ "$DRY_RUN" -eq 1 ]]; then
    args+=(--dry-run)
  fi
  if [[ -n "$OTP" ]]; then
    args+=(--otp "$OTP")
  fi
  (cd "$dir" && pnpm "${args[@]}")
}

for pkg in "${PACKAGES[@]}"; do
  publish_one "$pkg"
done

echo "✓ published @reley/* v${VERSION} (${DIST_TAG})"

# ------------------------------------------------------------------------------
# Post-publish helpers
# ------------------------------------------------------------------------------

if [[ "$DRY_RUN" -eq 0 ]]; then
  echo "▸ git push + tags"
  git push --follow-tags
  echo "✓ done. install with: npm i -g @reley/core-cli@${VERSION}"
fi
