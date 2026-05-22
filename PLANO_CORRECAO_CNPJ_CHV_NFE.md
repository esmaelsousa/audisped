# PLANO — Correcao CNPJ Divergente na Chave NF-e/NFC-e (C100)

## Erro PVA

```
Mensagem: O CNPJ/CPF da chave da NF-e nao confere com o CNPJ/CPF do informante do arquivo.
Registro: C100
Campo: 9 - CHV_NFE
```

## Caso Real

| Item | Valor |
|------|-------|
| Contribuinte | GUIMARAES XLVI COMERCIO DE PETROLEO LTDA |
| CNPJ Informante (0000) | 29922751000147 |
| Periodo | 01/2022 |
| Perfil | A |
| ID no sistema | 1448 |
| Arquivo original | uploads/949d5c1c0adbfdd7e67a4a275a689845 |

## Diagnostico

### Numeros

| Tipo | Total | Com CNPJ errado | CNPJ encontrado |
|------|-------|-----------------|-----------------|
| NFC-e (mod 65) saida/propria | 3.838 | 3.838 (100%) | 08944198000173 |
| NF-e (mod 55) saida/propria | 18 | 18 (100%) | 08944198000173 |
| NF-e (mod 55) entrada/terceiros | 12 | 0 (OK) | Diversos fornecedores |
| **Total C100** | **3.868** | **3.856** | |

### O que acontece

TODOS os documentos de emissao propria (IND_EMIT = '0') tem o CNPJ
**08944198000173** nas posicoes 6-19 da chave de acesso (CHV_NFE), mas o
registro 0000 declara o informante como **29922751000147**.

As raizes sao diferentes (08944198 vs 29922751) — nao e filial/matriz.

### Causa provavel

A empresa opera com equipamentos fiscais (sistema emissor de NFC-e/NF-e)
cadastrados em outro CNPJ — possivelmente:
- CNPJ anterior da mesma empresa (alteracao societaria)
- CNPJ de outra empresa do grupo compartilhando equipamento
- Erro no cadastro do sistema emissor

### Onde esta o erro

O erro existe **no arquivo SPED original** (3.856 de 3.868 C100 divergentes).
O audisped **nao altera** chaves de NF-e — apenas copia do original.

---

## Estrutura da Chave de Acesso NF-e

A chave de acesso tem 44 digitos com a seguinte estrutura:

```
Posicao:  0-1   2-5    6-19           20-21  22-24   25-33       34-34  35-43
Campo:    cUF   AAMM   CNPJ           mod    serie   nNF         tpEmis cNF
Tamanho:   2     4      14             2      3       9           1      8+1(DV)

Exemplo: 29 2201 08944198000173 65 002 000103587 1 000164985
```

| Posicao | Campo | Tamanho | Descricao |
|---------|-------|---------|-----------|
| 0-1 | cUF | 2 | Codigo da UF (29 = Bahia) |
| 2-5 | AAMM | 4 | Ano e mes de emissao |
| 6-19 | CNPJ | 14 | CNPJ do emitente |
| 20-21 | mod | 2 | Modelo (55=NFe, 65=NFCe) |
| 22-24 | serie | 3 | Serie |
| 25-33 | nNF | 9 | Numero da NF |
| 34 | tpEmis | 1 | Tipo de emissao |
| 35-42 | cNF | 8 | Codigo numerico aleatorio |
| 43 | cDV | 1 | Digito verificador (modulo 11) |

---

## Calculo do Digito Verificador (DV)

O DV e calculado pelo metodo **modulo 11** sobre os primeiros 43 digitos:

```
1. Multiplicadores ciclicos: 2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, ...
   Aplicados da DIREITA para a ESQUERDA (do digito 42 ao digito 0)

2. Somar todos os produtos (digito * multiplicador)

3. resto = soma % 11

4. DV = (resto < 2) ? 0 : (11 - resto)
```

### Exemplo em JavaScript

```javascript
function calcularDVChaveNFe(chave43) {
    // chave43 = primeiros 43 digitos (sem o DV)
    const pesos = [2, 3, 4, 5, 6, 7, 8, 9];
    let soma = 0;
    for (let i = 42; i >= 0; i--) {
        const digito = parseInt(chave43[i], 10);
        const peso = pesos[(42 - i) % 8];
        soma += digito * peso;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
}
```

---

## Plano de Implementacao

### Principio

Corrigir APENAS documentos de **emissao propria** (IND_EMIT = '0') onde o CNPJ
na chave difere do CNPJ do informante. Documentos de terceiros (IND_EMIT = '1')
NAO devem ser tocados.

---

### Fase 0 — Detectar divergencias na importacao e consulta (analise sintatica)

**Arquivo**: `backend/server.js` — rota `/api/arquivos/analisar-sintaxe`

A rota aceita duas formas de uso (linhas 586-596 do server.js):
- **Arquivo novo** — via upload (`req.file`)
- **Arquivo ja importado** — via `id_arquivo` (busca no banco pelo `caminho_arquivo`)

Portanto, o alerta aparecera TANTO ao importar um arquivo novo QUANTO ao
carregar/reanalisar um arquivo que ja esta no banco de dados. O usuario
vera o alerta em ambos os cenarios, sem necessidade de reimportar.

**Logica no loop de analise sintatica:**

```
Adicionar ao objeto infractions:
    chv_nfe_cnpj_divergente: []

Capturar CNPJ do informante:
    AO ENCONTRAR 0000:
        cnpj_informante = fields[7].replace(/\D/g, '')

AO ENCONTRAR C100:
    chave = fields[9]
    ind_emit = fields[3]

    SE chave.length === 44 E ind_emit === '0':
        cnpj_chave = chave.substring(6, 20)

        SE cnpj_chave !== cnpj_informante:
            infractions.chv_nfe_cnpj_divergente.push({
                linha: i + 1,
                num_doc: fields[8],
                modelo: fields[5] === '65' ? 'NFC-e' : 'NF-e',
                cnpj_chave: cnpj_chave,
                cnpj_informante: cnpj_informante,
                alerta: 'CNPJ da chave (' + cnpj_chave + ') difere do informante ('
                      + cnpj_informante + '). Sera corrigido na exportacao.'
            })
```

**Resumo no retorno da analise:**

Alem da lista detalhada, incluir um resumo agrupado no final:

```
SE infractions.chv_nfe_cnpj_divergente.length > 0:
    // Agrupar por modelo e CNPJ encontrado
    Exibir: "X documentos NFC-e e Y documentos NF-e de emissao propria
             tem CNPJ divergente na chave. O sistema corrigira automaticamente
             na exportacao."
```

**Comportamento esperado na UI:**

O frontend (AnalisadorView ou similar) deve exibir um alerta destacado:

```
+-------------------------------------------------------------------+
|  CNPJ divergente na chave NF-e/NFC-e                              |
|                                                                    |
|  3.838 NFC-e e 18 NF-e de emissao propria tem CNPJ                |
|  08944198000173 na chave, mas o informante e 29922751000147.       |
|                                                                    |
|  O sistema corrigira automaticamente ao exportar o SPED.           |
+-------------------------------------------------------------------+
```

---

### Fase 1 — Implementar funcao de recalculo do DV

**Arquivo**: `backend/server.js` — adicionar funcao utilitaria antes da rota de export

```javascript
// Recalcula o digito verificador (posicao 43) de uma chave NF-e
// usando modulo 11 conforme Manual de Orientacao do Contribuinte (MOC)
function recalcularDVChaveNFe(chave43) {
    const pesos = [2, 3, 4, 5, 6, 7, 8, 9];
    let soma = 0;
    for (let i = 42; i >= 0; i--) {
        soma += parseInt(chave43[i], 10) * pesos[(42 - i) % 8];
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
}
```

### Fase 2 — Corrigir CHV_NFE na exportacao

**Arquivo**: `backend/server.js` — no loop de exportacao, ao processar C100

**Ponto de insercao**: No loop principal `for (const line of fileLines)`, onde
os registros sao processados. Adicionar ANTES do `pushLine(line)` default,
um bloco para C100:

```
AO ENCONTRAR C100:
    ind_oper = fields[2]   // 0=entrada, 1=saida
    ind_emit = fields[3]   // 0=emissao propria, 1=terceiros
    chave = fields[9]      // CHV_NFE (44 digitos)

    SE ind_emit === '0' E chave.length === 44:
        cnpj_chave = chave.substring(6, 20)

        SE cnpj_chave !== cnpjArq:
            // Substituir CNPJ na chave
            chave_corrigida = chave.substring(0, 6)
                            + cnpjArq
                            + chave.substring(20, 43)

            // Recalcular DV
            dv = recalcularDVChaveNFe(chave_corrigida)
            chave_final = chave_corrigida + String(dv)

            fields[9] = chave_final
            changesApplied++
            logger.info('[Export C100] CNPJ corrigido na CHV_NFE: '
                + cnpj_chave + ' -> ' + cnpjArq
                + ' Doc=' + fields[8])

    pushLine(fields.join('|'))
    continue
```

### Fase 3 — Verificacao pos-export

Apos a exportacao, validar que:

```
Para cada C100 com IND_EMIT = '0':
    CNPJ na CHV_NFE (pos 6-19) === CNPJ do 0000
    DV da chave (pos 43) e valido (recalculo bate)
```

---

## Regras de Seguranca (nao gerar novos erros)

### O que corrigir

| Condicao | Acao |
|----------|------|
| IND_EMIT = '0' (emissao propria) E CNPJ chave != CNPJ informante | Corrigir CNPJ + recalcular DV |
| IND_EMIT = '1' (terceiros) | NAO TOCAR — CNPJ do fornecedor e correto |
| Chave com menos de 44 digitos | NAO TOCAR — pode ser documento sem chave |
| Chave vazia | NAO TOCAR |
| CNPJ da chave ja confere com informante | NAO TOCAR |

### O que NAO alterar

| Campo | Razao |
|-------|-------|
| IND_OPER (campo 2) | Direcao do documento nao muda |
| IND_EMIT (campo 3) | Indicador de emissao nao muda |
| COD_MOD (campo 5) | Modelo do documento nao muda |
| NUM_DOC (campo 8) | Numero do documento nao muda |
| Campos de valor (11-29) | Valores monetarios nao mudam |
| C170, C190 filhos | Nao tem CHV_NFE |

### Campos da chave que mudam

| Posicao | Campo | Antes | Depois |
|---------|-------|-------|--------|
| 6-19 | CNPJ | 08944198000173 | 29922751000147 |
| 43 | DV | (original) | (recalculado) |
| 0-5, 20-42 | Demais | Inalterados | Inalterados |

### Interacao com outras funcoes do export

| Funcao existente | Impacto |
|------------------|---------|
| Filtro 0200/0206/0205 | Nenhum — C100 nao afeta cadastro de produtos |
| flush1300Group (1300/1310) | Nenhum — C100 e bloco C, 1300 e bloco 1 |
| Escudo ANP | Nenhum — opera sobre 1300 |
| Continuidade intermensal | Nenhum — opera sobre 1300 |
| Recalculo contadores 9900 | Nenhum — a quantidade de C100 nao muda |
| Fix C (0150 do 1601) | Nenhum — opera sobre bloco 0/1 |
| Encerrantes 1320 | Nenhum — opera sobre bloco 1 |
| H010 inventario | Nenhum — opera sobre bloco H |

---

## Riscos e Mitigacoes

| Risco | Probabilidade | Mitigacao |
|-------|--------------|-----------|
| Chave alterada nao existe na SEFAZ | Certa | O PVA nao consulta SEFAZ online. A chave so serve para validacao local. O contribuinte ja esta irregular de qualquer forma (chave com CNPJ errado) |
| DV recalculado incorretamente | Baixa | Funcao de modulo 11 e trivial e amplamente documentada. Testar com chaves conhecidas |
| Alterar documento de terceiros por engano | Baixa | Filtro explicito por IND_EMIT = '0'. Dupla checagem no plano |
| Outros campos do C100 afetados | Nula | Apenas field[9] (CHV_NFE) e modificado |

---

## Validacao do Plano

### Antes de implementar

- [ ] Confirmar que o erro existe em outros arquivos do mesmo contribuinte
      (outros meses de 2022) para garantir que a correcao e generica

### Apos implementar

- [ ] Exportar arquivo 1448 (GUIMARAES jan/2022)
- [ ] Contar C100 com CNPJ divergente: deve ser 0
- [ ] Validar DV de todas as chaves alteradas
- [ ] Verificar que entradas de terceiros NAO foram alteradas
- [ ] Verificar que contadores 9900 estao corretos
- [ ] Verificar que outros blocos (1300, H010, 0200) nao foram afetados
- [ ] Testar no PVA: erro de CNPJ na chave deve sumir

---

## Abrangencia

Esta correcao se aplica a **qualquer arquivo SPED** de qualquer empresa onde
documentos de emissao propria tenham CNPJ divergente na chave. Nao e especifica
para a GUIMARAES XLVI — funciona genericamente comparando o CNPJ da chave com
o CNPJ do registro 0000.

---

## Status

- [ ] Fase 0 — Deteccao na importacao/analise sintatica (alerta ao usuario)
- [ ] Fase 1 — Funcao recalcularDVChaveNFe
- [ ] Fase 2 — Correcao CHV_NFE no loop de export
- [ ] Fase 3 — Validacao pos-export

**Criado em:** 12/05/2026
**Prioridade:** Alta — 3.856 erros por arquivo, bloqueia validacao PVA
