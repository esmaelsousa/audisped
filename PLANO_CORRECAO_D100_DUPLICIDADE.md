# PLANO DE CORRECAO — DUPLICIDADE D100 E VALIDACOES SPED

Data: 10/05/2026
Status: AGUARDANDO APROVACAO — Nenhuma alteracao sera aplicada sem autorizacao.

---

## DIAGNOSTICO

Empresa de referencia: posto de exemplo
CNPJ: «CNPJ»
Periodo: 01/05/2025 a 31/05/2025
Arquivo: «CNPJ»_20250501_20250531.txt

### Erros encontrados (confirmados no SPED e no PDF do PVA)

| Erro | Qtd | Descricao |
|---|---:|---|
| D100 duplicados | 22 | 11 CT-es do participante fornecedor de exemplo («CNPJ»), cada um aparece 2x com linhas identicas |
| E110 vs E116 | 1 | Somatorio E116 nao bate com E110 |
| Total | 23 | |

### Causa da duplicidade

O arquivo SPED original ja vem com cada CT-e escrito duas vezes
(mesma CHV_CTE, mesmo NUM_DOC, mesma data, mesmo valor).
Erro do sistema que gerou o SPED original.

### Como o sistema trata o D100 hoje

| Etapa | O que faz | Trata duplicidade? |
|---|---|---|
| Importacao (parse, parseSpedFile) | Le todos os D100 e salva em blocoD[] | NAO — aceita tudo sem filtro |
| Banco (INSERT documentos_d100) | Insere todos sem constraint de unicidade | NAO |
| Exportacao (loop principal) | Passa o D100 direto via pushLine(line) | NAO — nao detecta duplicatas |

O erro entra, e salvo e e exportado — ninguem filtra.

---

## CORRECOES PROPOSTAS

### FASE 1 — Remocao de duplicatas na EXPORTACAO (prioridade)

**Arquivo:** backend/server.js
**Local:** Loop principal de exportacao, entre os handlers de C190 e E210

**O que fazer:**
1. Manter um Set de chaves D100 ja exportadas
2. Ao encontrar |D100|, montar a chave de unicidade:
   NUM_DOC + COD_MOD + COD_SIT + SER + SUB + CHV_CTE + COD_PAR
3. Se a chave ja foi exportada → pular (continue, nao pushLine)
4. Pular tambem os filhos do D100 duplicado (D110, D120, D130, D190)
5. Recalcular contadores 9900/D990

**Pseudo-codigo:**

```javascript
// Antes do loop:
const d100KeysExportadas = new Set();
let skipD100Filhos = false;

// Dentro do loop, ANTES do catch-all pushLine(line):
if (fields.length >= 2 && fields[1] === 'D100') {
    const keyD100 = [fields[9], fields[5], fields[6], fields[7], fields[8], fields[10], fields[4]].join('|');
    if (d100KeysExportadas.has(keyD100)) {
        skipD100Filhos = true;
        changesApplied++;
        logger.info(`[Fix D100] Duplicata removida: NUM_DOC=${fields[9]} CHV_CTE=${fields[10]?.substring(0,20)}`);
        continue; // nao exporta o D100 duplicado
    }
    d100KeysExportadas.add(keyD100);
    skipD100Filhos = false;
}

// Filhos do D100 (D110, D120, D130, D140, D150, D160, D170, D180, D190):
if (fields.length >= 2 && skipD100Filhos &&
    ['D110','D120','D130','D140','D150','D160','D170','D180','D190'].includes(fields[1])) {
    continue; // pula filhos do D100 duplicado
}

// Reset do flag quando encontra outro D100 ou registro de nivel superior:
if (fields.length >= 2 && ['D100','D001','D500','D990','C001','E001','1001'].includes(fields[1])) {
    if (fields[1] !== 'D100') skipD100Filhos = false;
}
```

**Risco:** Medio — precisa garantir que os filhos (D190) do duplicado
sejam ignorados junto. Testar com o arquivo do posto de exemplo.
**Reversibilidade:** git revert do commit.

---

### FASE 2 — Deteccao na IMPORTACAO (flag para o usuario)

**Arquivo:** backend/server.js
**Local:** Funcao parseSpedFile() (parse do D100) e rotina de validacao/analise

**O que fazer:**
1. Durante o parse do D100, montar a chave de unicidade
2. Se a chave ja existe → marcar como duplicata (nao inserir no banco)
3. Registrar na tabela erros_analise como erro tipo DUP-D100-01
4. Mostrar no Analisador: "X CT-es duplicados encontrados"

**Regra de deteccao:**

```javascript
// No parseSpedFile, ao ler D100:
const d100Keys = new Set();
// ...
} else if (reg === 'D100') {
    const keyD100 = `${fields[9]}|${fields[5]}|${fields[6]}|${fields[7]}|${fields[8]}|${fields[10]}|${fields[4]}`;
    const isDuplicate = d100Keys.has(keyD100);
    d100Keys.add(keyD100);

    if (!isDuplicate) {
        data.blocoD.push({ ... });
    } else {
        data.errosImportacao.push({
            tipo: 'DUP-D100-01',
            linha: lineCounter,
            descricao: `CT-e duplicado: NUM_DOC=${fields[9]} CHV_CTE=${fields[10]}`
        });
    }
}
```

**Risco:** Baixo — so adiciona deteccao, nao altera dados existentes.
**Reversibilidade:** git revert do commit.

---

### FASE 3 — Extensibilidade para outros erros

**Arquivo novo:** backend/services/spedValidatorService.js

**O que fazer:**
Criar um modulo de validacao registravel que rode tanto na importacao
quanto na exportacao. Cada validacao e uma funcao independente.

**Validacoes iniciais:**

| ID | Registro | Descricao | Fase |
|---|---|---|---|
| DUP-D100 | D100 | Duplicidade de CT-e pela chave NUM_DOC+COD_MOD+SER+CHV_CTE+COD_PAR | Import + Export |
| DUP-C100 | C100 | Duplicidade de NF-e pela chave NUM_DOC+COD_MOD+SER+CHV_NFE+COD_PAR | Import + Export |
| E116-SUM | E110/E116 | Somatorio E116 nao bate com VL_TOTAL_ICMS do E110 | Import (alerta) |

**Estrutura do modulo:**

```javascript
// services/spedValidatorService.js
const validators = [
    { id: 'DUP-D100', registro: 'D100', fn: checkDupD100 },
    { id: 'DUP-C100', registro: 'C100', fn: checkDupC100 },
    { id: 'E116-SUM', registro: 'E110', fn: checkE116Sum },
];

function checkDupD100(lines) { ... retorna lista de duplicatas ... }
function checkDupC100(lines) { ... }
function checkE116Sum(lines) { ... }

module.exports = { validators, runAll };
```

**Risco:** Baixo — modulo novo, nao altera codigo existente.
**Reversibilidade:** deletar o arquivo.

---

## ORDEM DE IMPLEMENTACAO

```
Passo 1: Implementar FASE 1 (exportacao) — resolve o problema imediato
Passo 2: Testar com arquivo do posto de exemplo — verificar que duplicatas somem
Passo 3: Testar com 1+ outro posto — garantir que nao quebrou nada
Passo 4: Implementar FASE 2 (importacao) — deteccao e alerta
Passo 5: Implementar FASE 3 (extensibilidade) — quando houver mais erros
```

---

## TESTES OBRIGATORIOS

### Apos FASE 1
- [ ] Exportar SPED do posto de exemplo (mai/2025)
- [ ] Verificar que D100 duplicados foram removidos (24 → 13 registros)
- [ ] Verificar que filhos D190 dos duplicados foram removidos junto
- [ ] Verificar que contadores 9900/D990/9999 estao corretos
- [ ] Validar no PVA: erro de duplicidade deve sumir
- [ ] Exportar SPED de outro posto (regressao): nao deve perder D100 legitimos

### Apos FASE 2
- [ ] Importar o SPED do posto de exemplo
- [ ] Verificar que erros_analise tem 11 registros DUP-D100-01
- [ ] Verificar que documentos_d100 tem 13 registros (sem duplicatas)
- [ ] Verificar que o Analisador mostra o alerta

---

## ARQUIVOS IMPACTADOS

| Fase | Arquivo | Tipo |
|---|---|---|
| 1 | backend/server.js (loop de exportacao) | Adicao de handler D100 |
| 2 | backend/server.js (parseSpedFile) | Filtro na importacao |
| 3 | backend/services/spedValidatorService.js | Arquivo NOVO |

Nenhum dado do banco sera alterado.
Nenhum arquivo SPED sera sobrescrito.

---

## GARANTIAS DE REVERSIBILIDADE

1. Branch separada para cada fase
2. Commits atomicos (1 por fase)
3. SPED original nunca e sobrescrito
4. D100 duplicado e apenas ignorado na exportacao, nao deletado do arquivo
5. Rollback: git revert HEAD

---

## STATUS

**Nenhuma alteracao foi aplicada.**
**Este plano aguarda aprovacao antes de qualquer implementacao.**
