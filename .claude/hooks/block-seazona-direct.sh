#!/usr/bin/env bash
# PreToolUse(Bash) guard: Seazona blocks the WHOLE integration (prod included)
# when its 60 req/min limit is exceeded. Every call must go through
# apps/api/src/services/seazona.service.js, which enforces the limit.
# This denies (a) shell commands that hit Seazona directly and (b) scripts that
# read the Seazona credentials/host themselves instead of using the service.
set -u
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')
cwd=$(printf '%s' "$input" | jq -r '.cwd // ""')
[ -n "$cwd" ] && cd "$cwd" 2>/dev/null

SZ='seazonaapi|labzona|SEAZONA_SECRET|SEAZONA_API_KEY|SEAZONA_BASE_URL'

deny() {
  jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

# (a) A command that names Seazona AND makes a request or runs code inline.
if printf '%s' "$cmd" | grep -Eiq "$SZ" && printf '%s' "$cmd" | grep -Eiq '(curl|wget|http|node +-e|node +--eval|python3? +-c|fetch\()'; then
  deny "Blocked: direct Seazona API call. Seazona blocks the whole integration (production too) past 60 requests/min. Use apps/api/src/services/seazona.service.js, which enforces the limit, and get the user's OK for anything over ~100 requests (see CLAUDE.md)."
fi

# (b) Any script file the command runs that talks to Seazona itself.
# Only files the command EXECUTES (node/tsx/bun/deno/python/bash/sh <file>),
# not files it merely reads (grep, cat, sed).
scripts=$(printf '%s' "$cmd" \
  | grep -Eo '(^|[;&|( ])(node|tsx|bun|deno|python3?|bash|sh)( +-[^ ]+)* +[^ "'"'"';&|()]+\.(mjs|cjs|js|ts|py|sh)' \
  | grep -Eo '[^ ]+\.(mjs|cjs|js|ts|py|sh)$' | sort -u)
# Follow relative imports one level, so a script can't launder the call
# through a local helper (e.g. import { get } from "./raw-client.mjs").
for f in $scripts; do
  [ -f "$f" ] || continue
  dir=$(dirname "$f")
  for imp in $(grep -Eo "from +['\"]\.{1,2}/[^'\"]+['\"]|require\(['\"]\.{1,2}/[^'\"]+['\"]\)" "$f" 2>/dev/null | grep -Eo "\.{1,2}/[^'\"]+"); do
    scripts="$scripts $dir/$imp"
  done
done
for f in $scripts; do
  [ -f "$f" ] || continue
  case "$f" in *seazona.service.js|*config/env.js) continue ;; esac
  # A credential READ or the API host — not a mere mention in a message.
  if grep -Eq 'process\.env(\.|\[["'"'"'])SEAZONA_|environ.{0,4}SEAZONA_|seazonaapi\.net|labzona\.net' "$f" 2>/dev/null; then
    deny "Blocked: $f reads the Seazona credentials/host directly instead of importing apps/api/src/services/seazona.service.js. Bypassing the service skips its 60/min rate limit; Seazona blocks the whole integration (production too) when it's exceeded. Rewrite the script to use the service, run one process at a time, and get the user's OK for anything over ~100 requests."
  fi
done
exit 0
