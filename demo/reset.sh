#!/usr/bin/env bash
# reset.sh — wrapper de host para o reset do ambiente demo.
# Chama o demo-reset.js DENTRO do container demo (que tem DEMO_MODE=1 e a DATABASE_URL do demo).
# Use no cron diário e sob demanda (antes de uma call).
#
# Uso:  ./demo/reset.sh
set -euo pipefail
CONTAINER="${DEMO_CONTAINER:-audisped-demo-backend}"
echo ">> Reset do ambiente demo (container: $CONTAINER)..."
docker exec "$CONTAINER" node demo-reset.js
echo ">> Concluído."
