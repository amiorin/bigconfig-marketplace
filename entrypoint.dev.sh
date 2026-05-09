#!/bin/sh
set -eu

cd "$(dirname "$0")/pocketbase"

export LITESTREAM_DB_PATH="$PWD/pb_data/data.db"

mkdir -p "$PWD/pb_data"

litestream restore \
	-config ../litestream.yml \
	-if-db-not-exists \
	-if-replica-exists \
	"$LITESTREAM_DB_PATH"

exec litestream replicate \
	-config ../litestream.yml \
	-exec "pocketbase serve --dev"
