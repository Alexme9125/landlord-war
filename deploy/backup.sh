#!/bin/sh
set -eu
umask 077

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$PROJECT_DIR"

BACKUP_DIR=${1:-"$PROJECT_DIR/../landlord-war-backups"}
mkdir -p "$BACKUP_DIR"
BACKUP_DIR=$(CDPATH= cd -- "$BACKUP_DIR" && pwd)
BACKUP_NAME="landlord-war-$(date -u +%Y%m%dT%H%M%SZ)-$$.tar.gz"
VOLUME_NAME=landlord-war-data
SERVICE_NAME=landlord-war

docker volume inspect "$VOLUME_NAME" >/dev/null

WAS_RUNNING=false
if docker compose ps --status running --services | grep -Fxq "$SERVICE_NAME"; then
    WAS_RUNNING=true
fi

restart_if_needed() {
    STATUS=$?
    trap - EXIT HUP INT TERM
    if [ "$WAS_RUNNING" = true ]; then
        if ! docker compose start "$SERVICE_NAME"; then
            echo "Backup finished, but the app did not restart." >&2
            [ "$STATUS" -ne 0 ] || STATUS=1
        fi
    fi
    exit "$STATUS"
}
trap restart_if_needed EXIT HUP INT TERM

if [ "$WAS_RUNNING" = true ]; then
    docker compose stop "$SERVICE_NAME"
fi

docker run --rm \
    -v "$VOLUME_NAME:/data:ro" \
    -v "$BACKUP_DIR:/backup" \
    alpine:3 sh -c 'tar -czf "/backup/$1" -C /data .' sh "$BACKUP_NAME"

printf 'Backup saved to %s/%s\n' "$BACKUP_DIR" "$BACKUP_NAME"
