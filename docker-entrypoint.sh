#!/bin/sh
# docker-entrypoint.sh — for apps with a persistent volume. Template from
# the app-conventions skill.
#
# Starts as root only long enough to hand the data directory to the
# unprivileged user, then replaces itself with the app running as `node`.
# A volume first written by a root container holds root-owned files that
# `node` could not write; fixing that here, on every start, needs nothing
# done by hand on the server. Only files not already owned by node are
# touched, so after the first start this is instant.
set -eu
DATA="${DATA_DIR:-/data}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA"
  find "$DATA" ! -user node -exec chown node:node {} +
  # alpine: su-exec (apk add --no-cache su-exec); debian: setpriv (util-linux)
  if command -v su-exec >/dev/null; then exec su-exec node "$@"; fi
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
