#!/usr/bin/env bash
# smoke-auth.sh — verifica que as rotas sensíveis EXIGEM autenticação.
#
# Rodar ANTES de cada deploy (local e depois na VPS):
#   ./backend/tests/smoke-auth.sh                      # testa http://localhost:15435
#   ./backend/tests/smoke-auth.sh https://SEU_DOMINIO  # testa a produção
#
# Sai com código 0 se TUDO passar, 1 se qualquer checagem falhar.
# Contexto: hotfix §13.2 (PLANO_CONTROLE_USUARIOS_SAAS) — rotas de dados/destrutivas
# que antes respondiam sem login. Sem token deve dar 401; com token válido, 200.

set -uo pipefail

BASE="${1:-${SMOKE_BASE:-http://localhost:15435}}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"

PASS=0
FAIL=0

# check <METHOD> <PATH> <ESPERADO> [rótulo] [header-auth]
check() {
  local method="$1" path="$2" expected="$3" label="${4:-$2}" auth="${5:-}"
  local args=(-s -o /dev/null -w "%{http_code}" -X "$method")
  [ -n "$auth" ] && args+=(-H "Authorization: $auth")
  case "$method" in POST|PUT) args+=(-H "Content-Type: application/json" -d '{}');; esac
  local code
  code=$(curl "${args[@]}" "$BASE$path" 2>/dev/null)
  if [ "$code" = "$expected" ]; then
    printf "  \033[32m✓\033[0m %-42s %s (esperado %s)\n" "$label" "$code" "$expected"
    PASS=$((PASS+1))
  else
    printf "  \033[31m✗\033[0m %-42s %s (esperado %s)\n" "$label" "$code" "$expected"
    FAIL=$((FAIL+1))
  fi
}

echo "Alvo: $BASE"
echo ""
echo "== 1. SEM TOKEN — rotas sensíveis devem responder 401 =="
check GET    /api/de-para                   401 "GET  /api/de-para"
check GET    /api/resumo/1                   401 "GET  /api/resumo/:id"
check GET    /api/estoque-resumo/1           401 "GET  /api/estoque-resumo/:id"
check GET    /api/resumo/participante/1      401 "GET  /api/resumo/participante/:id"
check DELETE /api/arquivo/999999             401 "DELETE /api/arquivo/:id (seguro)"
check POST   /api/auth/register              401 "POST /api/auth/register"

echo ""
echo "== 2. TOKEN INVÁLIDO — deve ser rejeitado (403) =="
check GET /api/de-para 403 "GET  /api/de-para (token falso)" "Bearer abc.def.ghi"

echo ""
echo "== 3. TOKEN VÁLIDO — acesso legítimo deve passar (200) =="
TOKEN=$(cd "$BACKEND_DIR" && node -e "
require('dotenv').config({quiet:true});
const jwt=require('jsonwebtoken');
if(!process.env.JWT_SECRET){process.stderr.write('sem JWT_SECRET');process.exit(2);}
console.log(jwt.sign({id:1,nome:'smoke',email:'smoke'}, process.env.JWT_SECRET, {expiresIn:'5m'}));
" 2>/dev/null)
if [ -z "$TOKEN" ]; then
  printf "  \033[33m∼\033[0m token não gerado (JWT_SECRET ausente ou node/.env indisponível) — pulando bloco 3\n"
else
  check GET /api/de-para 200 "GET  /api/de-para (token válido)" "Bearer $TOKEN"
  check GET /api/cfops   200 "GET  /api/cfops   (token válido)" "Bearer $TOKEN"
fi

echo ""
echo "---------------------------------------------"
if [ "$FAIL" -eq 0 ]; then
  printf "\033[32mOK\033[0m — %d checagens passaram, 0 falharam.\n" "$PASS"
  exit 0
else
  printf "\033[31mFALHOU\033[0m — %d passaram, %d falharam. NÃO DEPLOYAR até corrigir.\n" "$PASS" "$FAIL"
  exit 1
fi
