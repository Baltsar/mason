#!/bin/zsh
set -e
cd -- "$(dirname -- "$0")"
pid_file=".runtime/server.pid"
if [[ ! -f "$pid_file" ]]; then
  echo "Apprentice does not appear to be running."
  exit 0
fi
server_pid="$(tr -cd '0-9' < "$pid_file")"
if [[ -z "$server_pid" ]]; then
  echo "Could not read the process ID."
  exit 1
fi
kill -TERM "$server_pid" 2>/dev/null || true
echo "Apprentice stopped."
