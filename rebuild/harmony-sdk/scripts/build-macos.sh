#!/usr/bin/env bash
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
deveco_root="${DEVECO_HOME:-/Applications/DevEco-Studio.app/Contents}"
export NODE_HOME="$deveco_root/tools/node"
export JAVA_HOME="$deveco_root/jbr/Contents/Home"
export DEVECO_SDK_HOME="$deveco_root/sdk"
export PATH="$NODE_HOME/bin:$deveco_root/tools/ohpm/bin:$PATH"
cd "$task_root"
if [[ ! -f build-profile.json5 ]]; then
  echo 'Missing local build-profile.json5. Copy build-profile.example.json5 first; configure your own signing in DevEco for device installation.' >&2
  exit 2
fi
case "${1:-hap}" in
  hap) task_module='entry@default'; task_action='assembleHap' ;;
  har) task_module='turbo_core@default'; task_action='assembleHar' ;;
  *) echo 'Usage: build-macos.sh [hap|har]' >&2; exit 2 ;;
esac
ohpm install
"$deveco_root/tools/hvigor/bin/hvigorw" --mode module -p product=default -p "module=$task_module" "$task_action" --no-daemon
