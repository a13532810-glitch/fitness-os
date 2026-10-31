#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if command -v pnpm >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then
  exec pnpm "$@"
fi
fitness_runtime="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node"
if [ -x "$fitness_runtime/bin/node" ] && [ -f "$fitness_runtime/node_modules/pnpm/bin/pnpm.cjs" ]; then
  PATH="$fitness_runtime/bin:$PATH"
  export PATH
  exec "$fitness_runtime/bin/node" "$fitness_runtime/node_modules/pnpm/bin/pnpm.cjs" "$@"
fi
printf '%s\n' '请先安装 Node.js 24 和 pnpm，然后运行 pnpm install --frozen-lockfile。' >&2
exit 1
