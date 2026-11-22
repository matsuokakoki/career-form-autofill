#!/bin/bash
set -eu
if [ "$#" -ne 1 ] || [[ ! "$1" =~ ^[a-p]{32}$ ]]; then
  echo 'Usage: ./native/install.sh CHROME_EXTENSION_ID (32 letters a-p)' >&2
  exit 1
fi
if [ "$(uname -s)" != Darwin ] || [ ! -x /usr/bin/fm ]; then
  echo 'macOS 27 and /usr/bin/fm are required.' >&2
  exit 1
fi
if ! /usr/bin/python3 -c 'import json' >/dev/null 2>&1; then
  echo 'Python 3 is required. Install Apple Command Line Tools: xcode-select --install' >&2
  exit 1
fi
hostdir="$HOME/Library/Application Support/Career Form Autofill"
manifestdir="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$hostdir" "$manifestdir"
install -m 700 "$(dirname "$0")/host.py" "$hostdir/host.py"
/usr/bin/python3 - "$hostdir/host.py" "$1" "$manifestdir/com.career_form_autofill.apple_fm.json" <<'PY'
import json, sys
with open(sys.argv[3], 'w') as f:
    json.dump({'name':'com.career_form_autofill.apple_fm', 'description':'Career Form Autofill Apple Foundation Models bridge', 'path':sys.argv[1], 'type':'stdio', 'allowed_origins':['chrome-extension://'+sys.argv[2]+'/']}, f, indent=2)
PY
echo 'Installed. Reload the extension in Chrome.'
