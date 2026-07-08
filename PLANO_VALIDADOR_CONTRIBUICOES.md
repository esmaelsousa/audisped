# Plano — Validador do PVA para EFD-Contribuições

> Espelha o **Validador de SPED Fiscal** (`backend/services/validador/`) já em produção, agora para
> EFD-Contribuições (PIS/COFINS). Objetivo do usuário: **detectar e corrigir tudo no nosso sistema, sem
> precisar gerar registro/bloco no PVA**. Catálogo de regras montado por uma **orquestra de 5 agentes
> especialistas em EFD-Contribuições**, calibrado contra os **94 erros reais** do arquivo da CASA DA
> BEBIDA (CNPJ 07520999000149, 05/2026) e contra o `PLANO_INJETOR_XML_CONTRIBUICOES.md`.
> **Nada foi alterado no sistema — isto é só o plano.**

---

## 1. Questionando seu pensamento — "não precisar gerar nada pelo PVA"

Separei o objetivo em **dois níveis** (porque o esforço/risco é muito diferente):

| Nível | O que significa | Viabilidade | Risco |
|---|---|---|---|
| **A — Zero erro de IMPORTAÇÃO** | o `.txt` entra no PVA sem nenhum dos 94 erros | **100% determinístico** | ~zero |
| **B — Zero "Gerar Apuração"** | o Bloco M (débito/crédito) já sai pronto, sem rodar a apuração do PVA | **só de graça p/ CST 06** (alíquota zero); p/ receita tributada/crédito exige computar apuração | **alto** (DARF/DCTF errado) |

- **Para o seu caso (CASA DA BEBIDA — revenda monofásica, CST 06):** débito e crédito reais são **zero**, então `M400/M800 = Σ CST 06` + correções estruturais já entregam o **nível B de graça**. Zero PVA, total.
- **Para empresas com receita tributada (CST 01/02) ou crédito de entrada não-cumulativa (CST 50-66):** o nível B exige o validador **calcular a apuração** (M210/M610, M100/M105/M500/M505) — alíquotas por CFOP/CST, exclusões de base, vedações de crédito, rateio. **Errar = imposto a maior/menor.** Os 5 agentes foram unânimes: **não fabricar isso no MVP**.

**Minha sugestão (melhor que "tudo de uma vez"):** entregar o **nível A determinístico já** (resolve 100% do seu perfil e faz qualquer arquivo *importar*), e evoluir o **nível B por fases calibradas** em arquivos não-cumulativos reais. Até lá, para empresas tributadas, o "Gerar Apuração" do PVA continua sendo o passo seguro — e o validador **avisa** isso (regras ADV `M210/M100-AUSENTE`), não promete zero-PVA universal cego.

---

## 2. Arquitetura — espelhar o Fiscal, reusar a engine de correção do Injetor

### Reuso DIRETO (sem tocar no Fiscal — são genéricos)
- **`parser.js`** — split por pipe, indexa `porReg`/`blocos`/`versao`/`periodoYM`. Serve qualquer SPED. **As-is.**
- **`engine.js`** — loop `regra.detectar(model)` + agregação por bloco + `chaveNatural` por linha + flag `corrigivel`. **As-is.**
- **`correcoes.js`** — `val_correcoes` (override = DADO, aplicado no export). Mecanismo idêntico. **As-is** (ou tabela irmã `val_correcoes_contrib`).

### NOVO
- **`backend/services/validador/rules_contrib/`** — 1 arquivo por regra (`r_*.js`), registrados num `index.js` próprio. Mesma interface do Fiscal: `{id, bloco, registro, titulo, severidade, classeCorrecao, jaCorrigidoNoExport, detectar(model), instrucaoERP}`.
- **`catalogo/leiaute_contrib.json`** — nº de campos por registro/`COD_VER` (006). Calibrar contra o Guia Prático EFD-Contribuições (medido nos reais: C170=38, 0000=14, 0200=11, M400/410/800/810=4, M200/600=12; faltam A/F/P).
- **Engine de correção = a do Injetor** (`spedContribuicoesService`): `garantir0500`, `aplicarCodCta`, `recalcularBlocoM`, `sanearCstPisCofins`, `recalcularFechamentosContrib`. **Uma só engine, dois front-ends** (injetar XML / validar-corrigir). O validador não reimplementa correção — chama as mesmas funções no export.

### Princípio "dois cérebros" (do Validador Fiscal)
O validador roda sobre os **bytes EXPORTADOS** (como o "Re-validar" do Fiscal) → vira **verificador independente do injetor**. Se `M400 ≠ Σ C170 CST06`, é bug do injetor — valioso pegar. Teste cruzado export↔validador no arnês golden.

### UI
Opção recomendada: **parametrizar a `ValidadorView.vue` existente** por tipo de SPED (Fiscal × Contribuições) com catálogo/endpoint dinâmicos — evita duplicar a tela. (Alternativa: `ValidadorContribuicoesView.vue` separada.)

---

## 3. Catálogo de regras (consolidado dos 5 agentes)

Classes: **EST** = estrutural-seguro (auto no export) · **FD** = fiscal-determinístico · **MAN** = manual (detecta + orienta).
"Auto" = corrigido automaticamente ao baixar.

### Bloco 0 — Cadastros + camada contábil
| ID | Reg | Sev | Classe | Auto | O que faz |
|---|---|---|---|---|---|
| `CONTRIB-0500-01` | 0500 | BLOQ | EST | ✅ | Gera 0500 placeholder se ausente (causa de 74 erros) |
| `CONTRIB-0500-02` | 0500 | BLOQ | EST | ✅ | Corrige COD_NAT_CC/IND_CTA/COD_CTA/NOME inválidos |
| `CONTRIB-0500-XREF` | 0500 | BLOQ | EST | ✅ | COD_CTA usado (C170/M/D100) sem entrada no 0500 → cria |
| `CONTRIB-0150-01` | 0150 | BLOQ | MAN | — | COD_PART de C100/D100/A100/F100 sem 0150 (espelha CAD-0150-07) |
| `CONTRIB-0200-ITEM-01` | 0200 | BLOQ | MAN | — | COD_ITEM de C170 sem 0200 (espelha DOC-C170-01) |
| `CONTRIB-0200-NCM-01` | 0200 | BLOQ | MAN | — | Mercadoria sem NCM 8 díg (espelha CAD-0200-03) |
| `CONTRIB-0190-01` | 0190 | BLOQ | EST | ✅ | UNID usada sem cadastro no 0190 → gera |
| `CONTRIB-0400-01` | 0400 | ADV | EST | ✅ | COD_NAT referenciado sem 0400 → gera |
| `CONTRIB-0110-01` | 0110 | BLOQ | MAN | — | Regime (COD_INC_TRIB) ausente/inválido — chave do gate de regime |
| `CONTRIB-0100-01` | 0100 | BLOQ | MAN | — | Contabilista sem CPF/CRC |

### Bloco C — Documentos (PIS/COFINS) — núcleo
| ID | Reg | Sev | Classe | Auto | O que faz |
|---|---|---|---|---|---|
| `CONTRIB-C170-CODCTA-01` | C170 | BLOQ | EST | ✅ | **COD_CTA (f37) ausente → carimba** (o grosso dos 74 erros) |
| `CONTRIB-C190-PROIBIDO-01` | C190 | BLOQ | EST | ✅ | C190 presente (não existe no Contrib) → remove |
| `CONTRIB-C170-CFOP-01` | C170 | BLOQ | EST | ✅ | CFOP inválido (4 díg, 1/2/3/5/6/7) |
| `CONTRIB-C170-CODNAT-01` | C170 | ADV | EST | ✅ | COD_NAT (f12) ausente → preenche/gera 0400 |
| `CONTRIB-CST06-ZERA-01` | C170 | BLOQ | FD | ✅ | CST 06-09 (sem incidência) com base/valor → zera |
| `CONTRIB-CST01-BASE-01` | C170 | BLOQ | FD | ⚠️ | **CST 01-05/50-56 sem BC/ALIQ/VL** (os 16 erros) → de-para: reclassificar ou preencher (**confirmação humana**) |
| `CONTRIB-CST-TAB-01` | C170 | BLOQ | MAN | — | CST fora da Tabela 4.3.3/4.3.4 |
| `CONTRIB-CST-OPER-01` | C170 | ADV | MAN | — | Faixa CST × operação incoerente (saída usa 50-75 / entrada usa 01-09) |
| `CONTRIB-ALIQ-PAD-01` | C170 | ADV | MAN | — | ALIQ fora do padrão do regime (NC 1,65/7,60; Cum 0,65/3,00) |
| `CONTRIB-C100-CHV-DV` | C100 | BLOQ | MAN | — | Chave 44 díg + DV (espelha DOC-CHV-DV) |
| `CONTRIB-C100-DUP` | C100 | BLOQ | EST | ✅ | C100 duplicado por chave (espelha DOC-DUP) |
| `CONTRIB-C100-VLMERC` | C100 | ADV | MAN | — | VL_MERC ≠ Σ VL_ITEM dos C170 |
| `CONTRIB-C170-VLITEM` | C170 | BLOQ | MAN | — | VL_ITEM ausente/não numérico |

### Bloco M — Apuração
| ID | Reg | Sev | Classe | Auto | O que faz |
|---|---|---|---|---|---|
| `CONTRIB-M-CODCTA-01` | M400/410/800/810 | BLOQ | EST | ✅ | COD_CTA (f4) ausente → carimba (parte dos 74 erros) |
| `CONTRIB-M200-VAZIO-01` | M200/M600 | BLOQ | EST | ✅ | Campo numérico vazio → `0,00` (os 2 erros) |
| `CONTRIB-M400-SOMA-CST06-01` | M400/410/800/810 | BLOQ | FD | ✅ | VL_TOT_REC ≠ Σ VL_ITEM C170 CST06 → recalcula (invariante verificada 22.930,56) |
| `CONTRIB-M210-AUSENTE-01` | M210/M610 | ADV | MAN | — | Receita tributada (CST 01/02) sem débito apurado → **Fase 3 / Gerar Apuração** |
| `CONTRIB-M100-AUSENTE-01` | M100/105/500/505 | ADV | MAN | — | Crédito de entrada não-cumulativa não apurado → **Fase 4 / Gerar Apuração** |

### Blocos A/D/F/P + Estrutura + Bloco 9
| ID | Reg | Sev | Classe | Auto | O que faz |
|---|---|---|---|---|---|
| `CONTRIB-EST-9XXX-CONT` | 9900/X990/9990/9999 | BLOQ | EST | ✅ | Totalizadores (inclui A/F/M/P, que o Fiscal não cobre) |
| `CONTRIB-EST-9900-INEDITO` | 9900 | BLOQ | EST | ✅ | Registro inédito (ex.: 0500) sem linha 9900 → cria (armadilha D7) |
| `CONTRIB-EST-INDMOV-01` | X001 | BLOQ | EST | ✅ | IND_MOV incoerente — **polaridade própria do Contrib** (0=com dados) |
| `CONTRIB-EST-NCAMPOS-01` | (catálogo) | BLOQ | EST | ✅ | Nº de campos ≠ leiaute (por COD_VER 006) |
| `CONTRIB-EST-X990-AUSENTE` | X990/X001 | BLOQ | EST | ✅ | Bloco presente sem abertura/fechamento |
| `CONTRIB-EST-HIER-01` | (vários) | BLOQ | MAN | — | Registro filho órfão (mapa pai/filho do Contrib) |
| `CONTRIB-EST-ORDEM-01` | (blocos) | BLOQ | MAN | — | Ordem 0,A,C,D,F,M,P,1,9 — **guarda-corpo, não auto** (mover quebra M) |
| `CONTRIB-D100-CODCTA-01` | D100 | BLOQ | FD | ✅ | D100 (CT-e) sem COD_CTA (o cteInjector grava vazio) |

> **~33 regras.** As marcadas ✅ (EST/FD-auto) resolvem **92 dos 94 erros** da CASA DA BEBIDA sem intervenção.

---

## 4. Rastreabilidade — os 94 erros reais → regra que os mata

| Erro PVA (qtd) | Regra(s) | Auto? |
|---|---|---|
| COD_CTA obrigatório (74) | `CONTRIB-0500-01` + `C170-CODCTA-01` + `M-CODCTA-01` (+`D100-CODCTA`) | ✅ |
| CST 01 sem base/alíquota (16) | `CONTRIB-CST01-BASE-01` | ⚠️ de-para + confirmação |
| M200/M600 vazio (2) | `CONTRIB-M200-VAZIO-01` | ✅ |
| "linhas do bloco não conferem" (recorrente) | `CONTRIB-EST-9XXX-CONT` + `9900-INEDITO` | ✅ |

---

## 5. Faseamento (consenso dos 5 agentes)

| Fase | Escopo | Risco | Entrega |
|---|---|---|---|
| **1 — MVP determinístico** | parser/engine/registry espelhados + todas as regras **EST** (0500, COD_CTA C170/M/D100, M200/M600→0,00, M400=ΣCST06, contadores A/F/M/P, n-campos, IND_MOV, integridade referencial) | ~zero | **Arquivo importa com 0 erro; perfil CST 06 = zero PVA total** |
| **2 — Saneamento de CST** | `CST06-ZERA` (auto) + `CST01-BASE` via **de-para por produto** (reclassificar/preencher com confirmação) | médio | Cobre os 16 erros sem fabricar imposto cego |
| **3 — Débito apurado** | computar M210/M610 p/ receita tributada, **gated por regime**, calibrado em arquivo real | alto | Zero PVA p/ tributado cumulativo |
| **4 — Crédito apurado** | M100/M105/M500/M505 (crédito de entrada não-cumulativa) | **o mais alto** | Zero PVA universal |

Cada fase com **gate no PVA real** (v6.x) sobre os arquivos da CASA DA BEBIDA antes de marcar concluída.

---

## 6. Decisões a confirmar (você decide)

1. **Escopo do "zero PVA":** aceita entregar a **Fase 1** primeiro (importa com 0 erro; PVA só roda "Gerar Apuração" para débito/crédito real), evoluindo p/ apuração computada nas Fases 3/4? Ou quer mirar a apuração completa já?
2. **CST 01 (16 erros):** política default = **reclassificar 01→06** (como fizemos manual) ou **preencher BC=VL_ITEM×ALIQ**? Ambos precisam de **de-para por produto** (igual ao `de_para_xml` do Fiscal).
3. **0500 / conta contábil:** placeholder genérico `"1"` (REVISAR) basta, ou já cadastrar **plano de contas real por empresa** (`efd_contrib_plano_contas`) na Fase 1?
4. **UI:** parametrizar a `ValidadorView` existente (sem duplicar) ou criar `ValidadorContribuicoesView` separada?

---

## 7. Riscos
- **Apuração fabricada** (Fases 3/4) → imposto errado. Mitigação: faseado + calibrado em arquivo real + ADV até lá.
- **Auto-reclassificar CST cego** → subdeclara débito. Mitigação: `CST01-BASE` exige confirmação (de-para).
- **Polaridade do IND_MOV** (0=com dados no Contrib) → bug se espelhar o Fiscal cego. Já travado no catálogo.
- **Índices de campo** (0000=14, 0200=11, D100 COD_CTA) divergem do Fiscal → ler pelo `leiaute_contrib.json`/COD_VER, não herdar do Fiscal.
- **Placeholder de conta** em arquivo oficial → nome "REVISAR" + cadastro real por empresa.

---

## 8. Relação com os outros planos
- **`PLANO_INJETOR_XML_CONTRIBUICOES.md`** — fornece a **engine de correção** que este validador reusa (mesmas funções no export). Injetor e Validador = mesmos blocos, mesma costura, dois pontos de entrada.
- **`PLANO_MODULO_VALIDADOR_SPED.md`** — a arquitetura (parser/engine/rules/correcoes/UI) que este plano espelha.
