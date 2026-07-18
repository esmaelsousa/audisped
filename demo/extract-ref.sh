#!/usr/bin/env bash
# extract-ref.sh — copia as tabelas de REFERÊNCIA (públicas) do banco de PRODUÇÃO
# para o banco DEMO. NÃO copia nenhum dado de cliente (só ncm/cest — dados fiscais públicos).
#
# Rodar UMA vez ao provisionar o demo (e de novo só se a referência mudar em prod).
# Requer pg_dump/psql e as duas connection strings.
#
# Uso:
#   PROD_URL='postgres://user:pass@host:5432/audisped_db' \
#   DEMO_URL='postgres://user:pass@host:5433/audisped_demo_db' \
#   ./demo/extract-ref.sh
set -euo pipefail

: "${PROD_URL:?defina PROD_URL (banco de produção, somente leitura)}"
: "${DEMO_URL:?defina DEMO_URL (banco demo)}"

# Trava: o destino PRECISA ser o banco demo (evita despejar em produção por engano).
case "$DEMO_URL" in
  *demo*) : ;;
  *) echo "RECUSADO: DEMO_URL não contém 'demo' — abortado por segurança." >&2; exit 1 ;;
esac

TABELAS=(ncm cest)   # espelhe a KEEP-list de backend/demo-reset.js
ARGS=()
for t in "${TABELAS[@]}"; do ARGS+=(--table="$t"); done

echo ">> Extraindo referência de produção (${TABELAS[*]}) — apenas dados..."
# --data-only + as tabelas de destino já existem (setup_db.js as criou no demo).
pg_dump "$PROD_URL" --data-only --no-owner --no-privileges "${ARGS[@]}" \
  | psql "$DEMO_URL" -v ON_ERROR_STOP=1

echo ">> Referência carregada no banco demo."
