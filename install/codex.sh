#!/bin/sh
# Install the slopdocs skill for OpenAI Codex (CLI, IDE extension, desktop app).
#
# Codex discovers skills from `.agents/skills/<name>/SKILL.md` directories:
#   - repo-scoped:  ./.agents/skills          (checked into the project, shared with the team)
#   - user-scoped:  ~/.agents/skills          (applies to every project for the current user)
# See https://developers.openai.com/codex/skills. The canonical skill content
# lives at skills/slopdocs/SKILL.md in this repo; this script just places an
# unmodified copy of it where Codex looks.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/ryanskidmore/slopdocs/main/install/codex.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/ryanskidmore/slopdocs/main/install/codex.sh | sh -s -- --global
#
# Re-running is safe and picks up the latest skill content (installs are
# idempotent / upgrade-in-place).

set -eu

REPO="ryanskidmore/slopdocs"
REF="${SLOPDOCS_REF:-main}"
RAW_URL="https://raw.githubusercontent.com/${REPO}/${REF}/skills/slopdocs/SKILL.md"
SCOPE="repo"

usage() {
  cat <<'EOF'
Usage: codex.sh [--global|--repo]

  --repo    (default) install into ./.agents/skills/slopdocs -- checked into
            the current project, shared with anyone who clones it.
  --global  install into ~/.agents/skills/slopdocs -- available to Codex in
            every project for the current user.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --global | --user | -g)
      SCOPE="user"
      ;;
    --repo | --project)
      SCOPE="repo"
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "codex.sh: unknown argument: $arg" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [ "$SCOPE" = "user" ]; then
  if [ -z "${HOME:-}" ]; then
    echo "codex.sh: \$HOME is not set, cannot install --global" >&2
    exit 1
  fi
  DEST_DIR="${HOME}/.agents/skills/slopdocs"
else
  DEST_DIR="$(pwd)/.agents/skills/slopdocs"
fi
DEST_FILE="${DEST_DIR}/SKILL.md"

# If this script is being run from inside a slopdocs checkout (e.g.
# `./install/codex.sh`), install straight from the local file instead of
# fetching from GitHub -- useful for testing local edits, and avoids a
# network round trip. `curl ... | sh` doesn't hit this path since $0 there
# is just the shell, not a path into a slopdocs checkout.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" >/dev/null 2>&1 && pwd -P) || SCRIPT_DIR=""
LOCAL_SKILL=""
if [ -n "$SCRIPT_DIR" ] && [ -f "${SCRIPT_DIR}/../skills/slopdocs/SKILL.md" ]; then
  LOCAL_SKILL="${SCRIPT_DIR}/../skills/slopdocs/SKILL.md"
fi

mkdir -p "$DEST_DIR"
TMP_FILE="${DEST_FILE}.tmp.$$"
cleanup() { rm -f "$TMP_FILE"; }
trap cleanup EXIT

if [ -n "$LOCAL_SKILL" ]; then
  cp "$LOCAL_SKILL" "$TMP_FILE"
elif command -v curl >/dev/null 2>&1; then
  if ! curl -fsSL "$RAW_URL" -o "$TMP_FILE"; then
    echo "codex.sh: failed to download $RAW_URL" >&2
    exit 1
  fi
elif command -v wget >/dev/null 2>&1; then
  if ! wget -q "$RAW_URL" -O "$TMP_FILE"; then
    echo "codex.sh: failed to download $RAW_URL" >&2
    exit 1
  fi
else
  echo "codex.sh: need curl or wget to install the slopdocs skill" >&2
  exit 1
fi

mv "$TMP_FILE" "$DEST_FILE"

echo "slopdocs skill installed: $DEST_FILE"
echo "Codex picks up skill changes automatically; restart Codex if it doesn't appear."
