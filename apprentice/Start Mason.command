#!/bin/zsh
set -e
cd -- "$(dirname -- "$0")"
node scripts/build-reader.mjs
# The desktop app opens its window once at start. Close it and the island stays.
APPRENTICE_OPEN=1 exec node src/server.mjs
