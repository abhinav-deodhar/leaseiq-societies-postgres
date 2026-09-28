#!/bin/sh
set -eu

# One scan per container limits simultaneous scanner memory use.
# Exit 2 means scanner unavailable/busy, not a malware detection.
exec /usr/bin/flock \
  --exclusive \
  --wait 3 \
  --conflict-exit-code 2 \
  /tmp/leaseiq-clamscan.lock \
  /usr/bin/clamscan \
  --database=/var/lib/clamav \
  --fail-if-cvd-older-than=3 \
  "$@"
