# Plano / SOP — Injetar XML de SAÍDA no SPED (.txt)

> Procedimento padrão, generalizado a partir do caso que **deu certo** na
> CASA DA BEBIDA (Maio/2026, NF 4979/4980, CFOP 5405/CST 060 — validado no PVA).
> Memória: `injecao-manual-saida-txt`. Script de referência: `/tmp/inject_casa.py`.

## 1. Quando usar
Notas de **saída** (vendas) emitidas pela própria empresa que **faltam** no SPED
(numeração com buracos, XML autorizado mas não escriturado). Operação manual direto
no `.txt` da pasta `speds/` — o Injetor XML do app é entrada-only.

## 2. Insumos necessários
- O(s) **XML(s)** de saída (NF-e mod. 55, `tpNF=1`).
- O **`.txt` do SPED** da empresa/competência certa (conferir CNPJ no 0000 e período).
- Confirmar que a competência da NF (`dhEmi`) cai dentro do período do arquivo.

## 3. Estrutura por NF (espelhar o padrão do próprio arquivo)
1. **C100** — `IND_OPER=1`, `IND_EMIT=0`, `COD_PART`=destinatário, COD_MOD 55,
   COD_SIT 00, série, número, chave(44), DT_DOC, DT_E_S, VL_DOC, IND_PGTO, e os
   valores (VL_MERC, descontos, frete, BC/ICMS, ST…).
2. **C190** — consolidação por **CST|CFOP|ALIQ** (VL_OPR = soma; BC/ICMS/ST quando houver).
3. **C170** — **só se as NF irmãs do arquivo tiverem**. Neste ERP (Hiper) as saídas
   5405 vêm **sem C170** → não inventar. Se o arquivo detalhar itens nas saídas,
   incluir C170 igual às irmãs.
4. **0150** — criar o destinatário se não existir (COD_PART novo acima do maior;
   CPF no campo 6 / CNPJ no 5).

## 4. Classificação — o que decide a complexidade
| Tipo de saída | CST / CFOP | Débito ICMS? | Bloco E |
|---------------|-----------|--------------|---------|
| ST, substituído | 060 / 5405, 5403… | **Não** | **E110 intacto** ✅ mecânico |
| Isenta/N-trib | 040/041/060 | Não | intacto |
| **Tributada** | 000/020 com VL_ICMS | **Sim → débito** | **recalcular E110** ⚠️ |

- **Caso mecânico (sem débito):** idêntico ao que já fizemos. É o fluxo seguro,
  fazer primeiro.
- **Caso com débito (CST 00/20):** a saída soma ao **E110 VL_TOT_DEBITOS** (e ao
  débito do E111/registros de ajuste se houver). Recalcular o débito a partir dos
  C190 de saída (CFOP 5/6) e conferir E110 antes/depois **no PVA**.

## 5. Transformações
- **CFOP:** na saída normalmente **não vira** (já é 5xxx/6xxx do emitente). Só
  conferir se a XML traz CFOP coerente com a operação.
- **IND_PGTO:** espelhar as NF irmãs do arquivo (no caso, =0) — campo informativo.
- **Datas:** `dhEmi` → DT_DOC e DT_E_S no formato `DDMMAAAA`.

## 6. Recálculo de totalizadores (sempre)
`9999` = nº de linhas · cada `9900|REG|` = ocorrências do REG (Counter) ·
`0990`/`C990`/`9990`/`X990` = nº de linhas cujo REG começa com o prefixo do bloco
(inclui o próprio fechamento). Se incluir C170/0150 novos, eles entram nas contagens.

## 7. Processamento seguro (latin-1)
- Ler/gravar em **bytes, latin-1** (`open(...,'rb').decode('latin-1')` /
  `.encode('latin-1')`). O .txt tem acentos ANSI (`PEÇA`, `SUBSTITUIÇÃO`) que as
  ferramentas UTF-8 corromperiam.
- **Gerar arquivo novo** (`..._INJETADO.txt`), **nunca** sobrescrever o original.
- Idempotência: abortar se a NF já existe no arquivo.

## 8. Validação (obrigatória)
1. **Recontagem independente** no arquivo gerado: `9999`==linhas, `C990`==bloco C,
   `9900|C100/C190/0150` batem, C100 com 29 campos, acento latin-1 intacto, ordem
   por número.
2. `E110` deve permanecer igual (caso sem débito) ou bater o novo débito (caso com).
3. **Importar no PVA** — palavra final.

## 9. Edge cases
- Saída tributada (débito) → tocar bloco E (ver §4).
- Saída com desconto/frete → preencher VL_DESC/VL_FRT e refletir em VL_DOC/VL_MERC.
- Múltiplos itens com CFOP/CST diferentes → vários C190 (um por chave CST|CFOP|ALIQ).
- Destinatário já no 0150 → reusar o COD_PART existente (casar por CPF/CNPJ).
- Devolução de venda / CFOP de entrada na "saída" → tratar como o caso de compra
  (`PLANO_INJETAR_XML_COMPRA.md`).

## 10. Modelo de script
`/tmp/inject_casa.py` é o template: lê latin-1 → insere 0150/C100/C190 nos pontos
certos → recalcula totalizadores por contagem → grava `..._INJETADO.txt` → imprime
relatório. Reusar trocando os literais das notas.
