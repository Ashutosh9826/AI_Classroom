#!/usr/bin/env bash
set -euo pipefail

PISTON_DATA_DIRECTORY="${PISTON_DATA_DIRECTORY:-/tmp/piston}"

mkdir -p "${PISTON_DATA_DIRECTORY}"
chown -R piston:piston "${PISTON_DATA_DIRECTORY}"

su -- piston -c "PISTON_DATA_DIRECTORY=${PISTON_DATA_DIRECTORY} node /opt/piston/install-required-packages.js"

exec su -- piston -c "PISTON_DATA_DIRECTORY=${PISTON_DATA_DIRECTORY} sh -lc 'ulimit -n 65536 && node /piston_api/src'"
