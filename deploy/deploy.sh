#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
image=${1:?Usage: bash deploy.sh ghcr.io/owner/repo@sha256:digest}
if [[ ! "$image" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$ ]]; then
  echo "Expected an immutable GHCR image digest" >&2
  exit 1
fi
export AUTODUCK_IMAGE="$image"

# Download fully before replacing the running container.
docker compose -p autoduck -f compose.yaml pull
docker compose -p autoduck -f compose.yaml up -d --wait --wait-timeout 180
printf '%s\n' "$image" > current-image.txt
