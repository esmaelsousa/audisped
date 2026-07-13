# Plano UNIFICADO — SPED Automático × SEFAZ (captura, conciliação e injeção)

> Criado em 2026-07-11 · Status: **EM IMPLEMENTAÇÃO** (peças prontas; fechando os loops)
>
> **Este plano UNIFICA e substitui:**
> - `Plano Implementacao Sped Automatico com Xml.md` (plano-mãe: motor + MdeView)
> - `PLANO_CONCILIACAO_SEFAZ_CSV.md` (fonte CSV do mesmo motor)
> - `Plano Implementacao MDFE.md` (camada de execução da API EspiãoNFe v1-cloud)
>
> **Depende de (não absorve):** `Plano Implementacao ICMS Tributario XML.md` — qualidade tributária da injeção (BC/ST no C170/C190). É o "como injetar bem"; este plano é o "quando/o quê capturar e injetar".

---

## ⚑ Atualização 2026-07-13 — FASE ATUAL: só CONSULTA (read-only)

**Decisão do usuário:** por ora, o sistema **apenas CONSULTA e COMPARA** (quantidade, valores, faltantes, divergências) — **não baixa nem injeta** automaticamente. Foco em **praticidade**.

- **Loops A/B (download + injeção) → ADIADOS para o futuro.** O código já existe (endpoints `aplicar-faltantes`, `corrigir-divergentes` + núcleo `capturarEInjetarPorChaves`) mas os **botões da UI ficam ocultos** via flag `acoesInjecaoHabilitadas=false` (AnalisadorView.vue). Reativar = flipar a flag.
- **Duas opções de consulta (ambas read-only), pois os clientes terão o certificado das empresas:**
  1. **CSV** — cliente sobe a "Relação de NF-e" da SEFAZ (sem certificado, sem API). ✅ pronto (`/api/conciliacao/sefaz-csv`).
  2. **Automático** — resumo via API do provedor usando o **A1 do cliente**. ✅ pronto (`/api/conciliacao/sefaz-live`); depende do provedor ativo.
- **Cadastro do certificado no provedor (EspiãoNFe) = MANUAL, feito pelo usuário como serviço cobrado.** NÃO construir integração "registrar cert no provedor" (fora do escopo do sistema).
- **Motivo do adiamento do automático total:** fricção com a conta EspiãoNFe (API de consulta bloqueada por plano/permissão — "usuário bloqueado"; tokens confirmados corretos). Ver histórico. O automático liga sozinho quando o provedor destravar (o cert do cliente já cadastrado lá).

**Futuro (quando reativar a automação):** flipar `acoesInjecaoHabilitadas`, confirmar provedor (EspiãoNFe destravado ou Focus/Arquivei), e o download+injeção volta a funcionar (loops A/B abaixo).

---

## 1. Objetivo — dois loops automáticos

Com o SPED Fiscal já importado, cruzar contra a SEFAZ e agir:

- **Loop A — Nota faltando:** detectar NF-e de entrada que a SEFAZ tem contra o CNPJ e que **falta no SPED** → baixar o XML → **injetar**.
- **Loop B — Valor errado:** nota lançada com valor divergente da NF real → baixar o **XML real pela chave** → **re-injetar** a nota corrigida (substitui C100+C170+C190, mantendo consistência).

UX: **"detecta e propõe" (1 clique)** — o sistema mostra `N faltantes` + `N com valor errado` e o usuário aplica (tudo ou selecionado). Auditável e reversível.

---

## 2. Decisões (fechadas com o usuário)

- **Backbone de captura = EspiãoNFe** (já integrado; API v1-cloud com certificado A1). Não trocar — comparado com Nuvem Fiscal (desativa 31/07/2026), Focus NFe (R$548/mês, paridade) e Danfe Rápida; nenhum justifica migração.
- **Fallback de download por chave = Danfe Rápida** (grátis até 50 mil/mês; só nota ≤3 meses; NÃO descobre destinadas). Entra atrás da camada agnóstica.
- **Loop B corrige RE-INJETANDO** a nota do XML real (não override cirúrgico do VL_DOC) → evita erro de totalizador no PVA.
- **Camada agnóstica `CapturaProvider`** (download por chave plugável: EspiãoNFe ↔ Danfe Rápida).
- **Manifestação = só "Ciência da Operação"** (mínimo p/ liberar XML completo; não usar Confirmação).
- **Escopo = competência do SPED aberto** (não vaza p/ outros meses).
- **Só entradas** (saídas são emitidas pela própria empresa).

---

## 3. Arquitetura — motor único

```
Fonte SEFAZ (plugável)                 Motor de conciliação            Ação
──────────────────────                 ────────────────────            ─────
[CSV manual]  ─┐                                                    ┌─ Loop A: baixar XML + injetar
               ├─ csv-shape {invoices, byChave} ─► conciliar() ─────┤   (CapturaProvider → injetar-grupos)
[EspiãoNFe] ───┘   (mde_cache entradas)            (JÁ EXISTE)      └─ Loop B: baixar XML + re-injetar
 syncNotas live                                    faltantes            (CapturaProvider → forceReplace)
                                                   divergencia_valor
```

**Insight-chave:** `conciliar()` (backend/services/conciliacaoService.js:110) **já produz** `faltantes` (SEFAZ tem × SPED não tem) e `divergencia_valor`. Basta trocar a FONTE: um adaptador `mde_cache → csv-shape` faz a mesma conciliação rodar sobre os dados vivos da SEFAZ (EspiãoNFe), sem CSV manual. Isso é a "convergência" que o plano CSV pedia.

**CapturaProvider (interface):**
- `baixarXmlPorChave(chave, {idEmpresa})` → XML completo (EspiãoNFe `/consulta/chave/xml`; fallback Danfe Rápida `/documents/b2b/search/:chave`).
- `listarDestinadasPeriodo(cnpj, ym)` → resumos (EspiãoNFe `/consulta/periodo/nfe-resumo` via `syncNotas`; Danfe Rápida NÃO implementa → só CSV cobre descoberta nesse fallback).
- `manifestar(chave, 'ciencia')` → EspiãoNFe `/manifestacao/nfe/manifestar`.

---

## 4. O que JÁ existe (reaproveitar — não reescrever)

| Capacidade | Arquivo:linha | Estado |
|---|---|---|
| Conciliação (motor de baldes) | `conciliacaoService.js:110` `conciliar()` | ✅ produz faltantes/divergencia_valor/competência |
| Parser CSV SEFAZ | `conciliacaoService.js:56` `parseSefazCsv` | ✅ define o csv-shape `{invoices, byChave, minYM, maxYM}` |
| Rota conciliação | `server.js:5682` `POST /api/conciliacao/sefaz-csv` | ✅ (só CSV) |
| Aba UI Conciliação | `AnalisadorView.vue:1573` (tab `conciliacao`) | ✅ exibe baldes + export; **sem** botão baixar/injetar |
| Captura SEFAZ live | `espiaoNfeService.js:39` `syncNotas` (`/consulta/periodo/nfe-resumo`) | ✅ grava `mde_cache` (chave, valor, tipo_operacao, xml_content) |
| Download XML por chave | `espiaoNfeService.js:118` `downloadXml` (`/consulta/chave/xml`) | ✅ |
| Manifestação Ciência | `espiaoNfeService.js:241`/`:332` `importarChavesLote` | ✅ (código 210210) |
| Download ZIP em lote | `espiaoNfeService.js:419` `downloadBatchZip` | ✅ |
| Injeção XML no SPED | `xmlInjectorService.js:85`; `server.js:1907` `/api/injetar-grupos` | ✅ (tela InjetorXmlView) |
| Re-injeção/substituição por chave | `server.js:1724`/`:2043` `forceReplace`→`chavesParaSubstituir` | ✅ (upload manual + flag) |
| Override valor por chave | `correcoes.js` (`val_correcoes`) | ✅ (correção manual, não "buscar XML real") |

---

## 5. Gap — o que FALTA (peças soltas → loops fechados)

1. **Detecção verdadeira de faltante** — `conferirFaltantes` (`espiaoNfeService.js:398`) está **semanticamente invertido** (acha "notas do SPED sem XML baixado") e roda contra cache local. Substituir por: adaptador `mde_cache(entradas) → csv-shape` + `conciliar()`.
2. **Loop A encadeado** — hoje o fluxo do MdeView **para no ZIP**; falta encadear faltante → `baixarXmlPorChave` → `injetar-grupos`.
3. **Loop B inexistente como cadeia** — `divergencia_valor` só sai do CSV; nada dispara download do XML real + `forceReplace`.
4. **Camada agnóstica** — EspiãoNFe está hardcoded (`espiaoNfeService.js:22`); criar `CapturaProvider` + adaptador Danfe Rápida.
5. **UI "detecta e propõe"** — painel com faltantes/divergentes + "Aplicar tudo"/seleção (na aba Conciliação do AnalisadorView).

---

## 6. Fases ordenadas — **ESTÁGIO ATUAL: início da Fase 1**

- [ ] **F1. Fonte SEFAZ plugável + detecção verdadeira** *(← começar aqui)*
  - `sefazShapeFromMdeCache(rows)` → `{invoices, byChave, minYM, maxYM, periodLabel, total}` (só `tipo_operacao='Entrada'`).
  - Endpoint/uso: `conciliar({ csv: <do mde_cache>, escrituradas, ... })` → faltantes reais + divergencia_valor a partir do EspiãoNFe live. **Testável puro** (sem DB/HTTP), no estilo da suíte do validador.
- [ ] **F2. `CapturaProvider`** — interface + `EspiaoProvider` (wrap do atual) + `DanfeRapidaProvider` (fallback por chave). Sem URL hardcoded.
- [ ] **F3. Loop A encadeado** — para cada faltante: `manifestar('ciencia')` (se preciso) → `baixarXmlPorChave` → `injetar-grupos`. Idempotente (dedup C100 já existe).
- [ ] **F4. Loop B encadeado** — para cada `divergencia_valor`: `baixarXmlPorChave` → `forceReplace` (re-injeta a nota). Reusa `chavesParaSubstituir`.
- [ ] **F5. UI "detecta e propõe"** — painel na aba Conciliação: contadores + tabela + "Aplicar tudo"/seleção; changelog reversível.

---

## 7. Riscos / pegadinhas (confirmados na pesquisa)

- **Janela de ~3 meses** da SEFAZ (Distribuição DFe): vale p/ TODOS os provedores. Competência antiga → só XML arquivado do cliente/ERP. Não é defeito do EspiãoNFe.
- **cStat 656 (Consumo Indevido/NSU):** o EspiãoNFe gerencia o NSU por CNPJ internamente → não rodar OUTRO sistema consultando o mesmo certificado em paralelo.
- **Divergência de valor legítima:** nem toda `divergencia_valor` é erro (ex.: nota parcialmente devolvida). Por isso o modo é **propor**, não sobrescrever cego.
- **XML completo exige Ciência** (regra SEFAZ NT 2014.002): sem manifestar, só resumo.

---

## Apêndice — Endpoints EspiãoNFe (v1-cloud) → loops

| Endpoint | Uso |
|---|---|
| `GET /v1-cloud/consulta/periodo/nfe-resumo` | Descoberta das destinadas (Loop A) → `mde_cache` |
| `GET /v1-cloud/consulta/chave/xml` | Download XML por chave (Loop A/B) |
| `POST /v1-cloud/manifestacao/nfe/manifestar` | Ciência (libera XML completo) |
| `POST /v1-cloud/resgatexml/chaves-acesso` + `/resgatexml/consulta/resgatados` | Resgate assíncrono por lista de chaves |
| `/v1-cloud/empresas/*`, `/v1-cloud/certificados/*` | Multi-CNPJ + certificado A1 |
| `GET /v1-api/geral/saldo` | Monitorar consumo/custo |
