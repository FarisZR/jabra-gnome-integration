#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
bash -n install.sh
for source in ./*.js tests/run.js tests/media.js; do
    node --input-type=module --check < "$source"
done
glib-compile-schemas --strict --dry-run schemas
python3 tests/socket_service.py
dbus-run-session -- gjs -m tests/media.js
python3 tests/package_test.py
