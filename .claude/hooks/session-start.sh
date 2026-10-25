#!/bin/bash
# .claude/hooks/session-start.sh — template from the app-conventions skill.
# A cloud session starts from a fresh clone: without this, the first `verify`
# falls over on a missing package. Does nothing on your own machine.
# Wire it in .claude/settings.json:
#   {"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh"}]}]}}
set -euo pipefail
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# install, not ci: a container that already has them keeps them
[ -f package.json ] && npm install --no-audit --no-fund

# No Playwright download: cloud containers ship a Chromium at /opt/pw-browsers.
exit 0
