#!/bin/sh
set -eu

PB_DATA_DIR=/storage/pb_data
PB_PUBLIC_DIR=/pb/pb_public
PB_HOOKS_DIR=/pb/pb_hooks
PB_MIGRATIONS_DIR=/pb/pb_migrations

mkdir -p "$PB_DATA_DIR"

litestream restore \
	-config /etc/litestream.yml \
	-if-db-not-exists \
	-if-replica-exists \
	"$PB_DATA_DIR/data.db"

if [ -n "${SUPERUSER_EMAIL:-}" ] && [ -n "${SUPERUSER_PASSWORD:-}" ]; then
	pocketbase superuser upsert "$SUPERUSER_EMAIL" "$SUPERUSER_PASSWORD" \
		--dir="$PB_DATA_DIR" \
		--publicDir="$PB_PUBLIC_DIR" \
		--hooksDir="$PB_HOOKS_DIR" \
		--migrationsDir="$PB_MIGRATIONS_DIR"
fi

PB_SERVE_CMD="pocketbase serve \
	--http=0.0.0.0:8090 \
	--dir=$PB_DATA_DIR \
	--publicDir=$PB_PUBLIC_DIR \
	--hooksDir=$PB_HOOKS_DIR \
	--migrationsDir=$PB_MIGRATIONS_DIR"

exec litestream replicate \
	-config /etc/litestream.yml \
	-exec "$PB_SERVE_CMD"
