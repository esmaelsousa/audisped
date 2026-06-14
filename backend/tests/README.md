# Testes do Validador + Arnês Golden-File do Export

## Suíte do Validador (sistemática)
Dois níveis, sem framework externo (scripts `node` standalone, exit code para CI):

```bash
npm run test:validador        # unitária PURA (sem banco, sem HTTP) — parser + engine + cada regra (pos/neg)
npm run test:validador:fleet  # integração em FROTA (lê o banco) — gate de regressão / canário de falso-positivo
npm run test:validador:all    # as duas em sequência
FLEET_N=50 npm run test:validador:fleet   # amostra maior
```

- **`validador-suite.js`** — afirma robustez do parser (vazio/null/malformado), o contrato do engine
  (regrasExecutadas, ids únicos, isolamento de regra que lança) e **positivo + negativo de cada regra**.
  Roda em qualquer lugar; é o gate rápido a rodar a cada mudança em `services/validador/`.
- **`validador-fleet.js`** — roda parser+engine numa amostra diversa de EMPRESAS/PERÍODOS reais e
  **falha (exit 1)** se houver erro de parse, falha interna de regra, ou se uma regra **canário**
  disparar (toda regra fora de `PODE_DISPARAR` = `CAD-0220-01, DOC-DUP, COMB-LMC, COMB-LMC-CONT`).
  Canário disparando = investigar (falso-positivo OU achado novo real).

> Ao adicionar/alterar uma regra: inclua o par positivo+negativo em `validador-suite.js` e rode `test:validador:all`.

---

# Arnês Golden-File do Export (Sprint 0 do Módulo Validador)

Garante que **mudanças de código não alteram o `.txt` exportado** — a prova de não-impacto
exigida antes de mexer no fluxo (ex.: quando o export passar a ler `val_correcoes`).

## Como funciona
- `baseline` exporta N arquivos reais (via `/api/exportar-sped` — sem tocar no código do export)
  e salva o resultado + `sha256` no `golden/manifest.json`.
- `check` re-exporta os mesmos arquivos e compara **byte a byte** (hash). Divergiu → `exit 1`.

## Uso (servidor rodando, a partir de `backend/`)
```bash
# 1) Captura a referência ANTES de qualquer alteração no export:
GOLDEN_IDS="1898,1326,609" node tests/golden-export.js baseline

# 2) Depois da alteração (ex.: leitura de val_correcoes), confirme idêntico:
node tests/golden-export.js check     # 0 = tudo idêntico; 1 = algo mudou
```
Sem `GOLDEN_IDS`, reusa os IDs do `manifest.json`; se vazio, pega uma amostra recente com arquivo físico.

## Regra de ouro
Antes de cada PR que toque o export (ou qualquer coisa por ele consumida), rode `baseline`
no código atual, aplique a mudança e rode `check`. **Com `val_correcoes` vazia o `check` tem de passar 100%.**

## Notas
- Os `golden/*.txt` contêm dado fiscal real → **gitignorados**. Só o `manifest.json` (hashes) vai ao git.
- O baseline deve ser **re-capturado** se os dados do arquivo no banco mudarem (reimportação), pois o hash é do conteúdo atual.
- Exportar grava `encerrantes_exportados` da competência (igual a um export normal do usuário); rode em arquivos já exportados — é idempotente.
- Não há framework (jest/vitest) no projeto; este é um script `node` standalone, intencionalmente sem dependências novas.
