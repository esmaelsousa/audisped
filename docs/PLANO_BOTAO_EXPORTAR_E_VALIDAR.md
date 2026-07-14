# Validar o SPED corrigido no Validador — JÁ EXISTE (não construir)

- **Data:** 2026-07-14
- **Status:** ✅ Funcionalidade já implementada — nenhum código novo necessário
- **Conclusão:** a demanda "validar o SPED já corrigido sem exportar+reimportar"
  já está pronta no módulo **Validador**. Este doc virou referência de USO.

---

## Resposta à dúvida original

> "Se eu importar um SPED com erro de LMC, corrigir pela redistribuição do LMC, e
> for ao Validador, os erros (ex.: estoque negativo) já aparecem corrigidos, ou
> tenho que exportar e reimportar?"

**Não precisa exportar+reimportar.** No Validador, use o botão
**"Re-validar (sobre o SPED corrigido)"**.

- O **"Analisar"** valida o `.txt` **ORIGINAL** → o estoque negativo ainda aparece.
- O **"Re-validar (sobre o SPED corrigido)"** valida o **SPED corrigido** → o erro
  some, porque a validação roda sobre o export, que aplica `COALESCE(*_ajustado)`
  (exatamente as colunas que a redistribuição do LMC grava).

> Atenção: isso fica na tela **Validador** (`ValidadorView.vue`), não na
> AnalisadorView.

---

## Onde está no código

### Frontend — `frontend/src/views/ValidadorView.vue`
- `revalidar()` → `POST /api/validador/revalidar/:id` (linha ~357-366)
- Botão **"Re-validar (sobre o SPED corrigido)"** (linha ~709-711)
- Botão **"Baixar SPED corrigido"** → download puro (linha ~706-707)
- Badge **"✓ validado sobre o SPED corrigido"** (linha ~651)

### Backend — `backend/server.js`
- `POST /api/validador/revalidar/:id` (linha ~6408): faz **loopback** interno a
  `GET /api/exportar-sped/:id`, pega o `.txt` corrigido (byte a byte igual ao
  download) e valida com o mesmo motor `parseSped + validar`. Retorna
  `validadoSobre: 'exportado'`.
- `GET /api/exportar-sped/:id` (linha ~7421): monta o SPED corrigido lendo
  `vol_saidas_ajustado / fech_fisico_ajustado / estq_abert_ajustado /
  vol_escr_ajustado` (linha ~7446-7450) — as colunas da redistribuição do LMC.

### Arquitetura (deliberada)
O Validador é **DB-only por id** — endpoints de upload avulso foram removidos de
propósito ([server.js:6222-6224](../backend/server.js#L6222)), para preservar o
histórico de correções por arquivo. O "Re-validar" respeita isso: valida por id,
sem reimportar e sem criar linha nova em `sped_arquivos`.

---

## Fluxo de uso recomendado

1. Corrige o erro de LMC no **módulo LMC** (redistribuição → grava `*_ajustado`).
2. No **Validador**: **Analisar** → depois **"Re-validar (sobre o SPED corrigido)"**.
3. Validador limpo → alta confiança nos erros **conhecidos**.
4. **"Baixar SPED corrigido"** → passa esse `.txt` no **PVA** (gate oficial).
5. PVA OK → transmite à SEFAZ.

> Nosso Validador é **pré-check** (cobre ~44 regras / catálogo ~80 erros), não
> substitui o PVA. Validar é o **último passo** antes de entregar.

---

## Ideias opcionais (NÃO aprovadas — só registro)
- Renomear "Re-validar" para algo mais óbvio ("Exportar e Validar").
- Expor o mesmo botão na AnalisadorView, se for onde o usuário trabalha.
