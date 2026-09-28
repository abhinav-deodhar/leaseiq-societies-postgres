#!/bin/sh
set -eu

cd /app

# Use the wrapper that enforces freshness and limits concurrent scans.
export DOCUMENT_CLAMSCAN_PATH=/app/scripts/scan-document.sh

if [ ! -w /var/lib/clamav ]; then
  printf '%s\n' 'ClamAV database directory is not writable.' >&2
  exit 1
fi

printf '%s\n' 'Starting ClamAV definition updates. Uploads require a successful scan.'

# FreshClam checks periodically. If its process exits, retry after an hour.
# The application can serve other features while definitions download.
(
  while :; do
    if /usr/bin/freshclam \
      --config-file=/app/scripts/freshclam.conf \
      --daemon \
      --foreground \
      --stdout
    then
      printf '%s\n' 'FreshClam stopped; restarting in one hour.' >&2
    else
      printf '%s\n' 'FreshClam exited with an error; retrying in one hour.' >&2
    fi
    sleep 3600
  done
) &

exec node /app/node_modules/next/dist/bin/next start \
  --hostname 0.0.0.0 \
  --port "${PORT:-3000}"
