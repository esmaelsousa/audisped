> ⚠️ **SUPERSEDED (2026-07-11):** unificado em [`PLANO_SPED_AUTOMATICO_SEFAZ.md`](PLANO_SPED_AUTOMATICO_SEFAZ.md). Mantido só como histórico.

# Plano — Conciliação SEFAZ (CSV) × Escrituração

> Criado em 10/06/2026 | Status: **Aguardando aprovação / definição de escopo**
> Relacionado a (NÃO duplicar): [Plano Implementacao Sped Automatico com Xml.md](Plano%20Implementacao%20Sped%20Automatico%20com%20Xml.md)

---

## 0. TL;DR / Recomendação

Trazer o HTML "Central de Conciliação Fiscal" para dentro do sistema **NÃO** deve ser um app novo separado. O CSV da SEFAZ é apenas **mais uma fonte do "conjunto esperado"** para o mesmo motor de conciliação de entradas que o plano do EspiãoNFe já descreve (4 categorias: OK / Sem XML / Faltantes / Saída).

- **Fonte da escrituração = BANCO** (`documentos_c100`), não re-upload do SPED.
- **Fonte do esperado = CSV** (agora, sem certificado) **ou** EspiãoNFe/SEFAZ (quando houver certificado).
- **Faltantes não terminam numa lista** — viram ação: injetar XML local ou baixar via EspiãoNFe e injetar.

---

## 1. O que o HTML faz hoje (inventário de funções)

| Função (HTML) | Papel | Destino no sistema |
|---|---|---|
| `parseSefaz(csv)` | Lê CSV SEFAZ: detecta delimitador (`;`/`,`), casa cabeçalhos flexíveis (nº NF, chave, valor, data emissão, razão social emitente, situação), monta `invoices[]`, `byChave`, `byNumero`, total e **período auto-detectado** pelas datas de emissão. | **Portar para o backend** (Node) — `conciliacaoService.parseSefazCsv()`. É a única peça realmente nova. |
| `parseSped(txt)` | Lê `0000` (período, razão, cnpj), `0150` (participantes), `C100` entrada mod 55, `C170` itens. | **Descartar** — já temos `documentos_c100` + `documentos_itens_c170` + `sped_participantes` no banco. |
| `keyOf(inv)` | Chave de matching: `C:<chave>` se 44 dígitos, senão `N:<numero>`. | Reusar **conceito**, mas endurecer (ver §4). |
| `analyze()` | Cruza SEFAZ × SPED → 4 baldes: **faltantes** (na SEFAZ, fora da escrituração), **divergência de valor**, **divergência de competência**, **extras** (escriturado fora da SEFAZ); + totais e quebra por período. | Lógica vai para `conciliacaoService.conciliar()` (server-side) ou reusar o JS no componente Vue (MVP). |
| `spedOutOfRange()` | Alerta SPED com competência fora do range do CSV. | **Some** no modo banco (a query já filtra pelo range). |
| Dashboard / tabelas / abas por período / export CSV/PDF | UI. | Recriar como aba/painel Vue (ver §5). |
| Destaque data emissão ≠ entrada (mês diferente) | Sinaliza lançamento em competência distinta. | Reaproveitar (`dt_doc` × `dt_e_s` de `documentos_c100`). |

---

## 2. Crítica da abordagem proposta (questionando seu pensamento)

> "Posso usar o SPED do banco **ou** carregar separado, e logo em seguida o CSV…"

1. **Não recarregue o SPED — use o banco.** `documentos_c100` já guarda `chv_nfe, num_doc, vl_doc, cod_part, cod_sit, dt_doc, dt_e_s, ind_oper, cod_mod` por `id_sped_arquivo`. Re-subir o `.txt` só pra comparar é redundante e **reintroduz** a classe de erro "arquivo errado / fora do período" que o próprio HTML tem que tratar (`spedOutOfRange`, badges vermelhos). Selecionar **empresa + período (ou range)** elimina isso. → Mantemos um modo "SPED avulso" só para o caso legítimo de conferir **antes** de importar.
2. **Não construa um silo de CSV.** Você já tem o pipeline EspiãoNFe (`espiaoNfeService.conferirFaltantes / syncNotas / importarChavesLote`) + a tela MD-e + um plano escrito pra essa exata conciliação. O CSV é a **fonte manual/sem-certificado** do mesmo motor. Um único motor, fontes intercambiáveis.
3. **O CSV ADICIONA o que a API não dá fácil:** `valor` e `data de emissão` por nota → habilita as checagens de **divergência de valor** e **de competência** (o resumo do EspiãoNFe normalmente só confirma existência da chave). Então o modo CSV é mais rico, não inferior.
4. **Feche o laço.** O HTML só lista faltantes (beco sem saída). No sistema, cada faltante deve virar ação: `xmlInjectorService.transformarNotasEmSped()` (XML local) ou EspiãoNFe (manifestar→baixar→injetar).

---

## 3. Arquitetura recomendada — motor único

```
            ┌─────────────── ESPERADO (o que deveria estar escriturado) ───────────────┐
Fonte A: CSV SEFAZ (upload, sem certificado)        Fonte B: EspiãoNFe syncNotas (API, cert. A1)
            └───────────────────────────┬───────────────────────────────────────────────┘
                                         ▼
                        conciliacaoService.conciliar(esperado, escriturado)
                                         ▲
            ESCRITURADO = documentos_c100 (ind_oper=0, cod_mod=55) da empresa no range
                                         │
                                         ▼
            4 baldes: FALTANTES · DIVERGÊNCIA VALOR · DIVERGÊNCIA COMPETÊNCIA · EXTRAS
                                         │
                        Ações sobre FALTANTES (reuso):
                        - injetar XML local  → POST /api/xml-injector/parse + transformarNotasEmSped
                        - baixar da SEFAZ     → /api/espiao/importar-lote (manifesta + baixa) → injetar
                        - exportar lista (CSV/PDF)
```

`esperado` e `escriturado` são normalizados para o mesmo shape `{ chave, numero, cnpjEmit, valor, dtEmissao, situacao }` → o motor é agnóstico à fonte.

---

## 4. Melhorias de correção sobre o HTML

1. **Matching por chave (44 díg.) é primário.** O fallback do HTML para `numero` puro é **inseguro** (o mesmo número colide entre fornecedores). Fallback correto = `numero + CNPJ emitente (+ valor)`. O CNPJ emitente sai das posições 7–20 da chave (mesma técnica do plano EspiãoNFe, Fase 2).
2. **Filtrar canceladas/denegadas.** O CSV traz a coluna `situacao` (o HTML lê e **ignora**). Notas Cancelada/Denegada não podem virar "faltante" → falso positivo. Filtrar.
3. **Detectar Saída** (CNPJ emitente = CNPJ da empresa) e ignorar — idêntico ao balde ⚪ do plano EspiãoNFe.
4. **Range multi-mês sem 6 arquivos.** Em vez de subir 6 SPEDs, a query varre `documentos_c100` de todos os `sped_arquivos` da empresa cujo `periodo_apuracao` intersecta o range detectado do CSV.
5. **Divergência de valor** com tolerância (R$ 0,01) e divergência de competência (`dt_doc` da SEFAZ vs competência do `id_sped_arquivo` onde a nota foi escriturada).

---

## 5. Onde mora na UI

- **Convergente (recomendado):** dentro de **MdeView.vue** (a tela que o plano EspiãoNFe já elege como ponto de entrada). Adicionar, ao lado de "Sincronizar com SEFAZ", a opção **"Comparar com CSV da SEFAZ"** (upload). Mesmo painel de 4 categorias, mesmas ações em lote.
- **Alternativa:** nova aba **"Conciliação SEFAZ"** em **AnalisadorView.vue** (linha do `activeTab`: dashboard/novo/notas/lmc/sintaxe/otimizador → +`conciliacao`), já que é onde você olha as notas de entrada. Útil se quiser a conciliação amarrada a 1 arquivo específico.

---

## 6. Endpoints novos / alterados

| Método | Rota | Entrada | Saída |
|---|---|---|---|
| POST | `/api/conciliacao/sefaz-csv` | multipart: `csv` (multer, padrão `upload.single`), `id_empresa`, opcional `range_ini`/`range_fim` (se ausente, usa o período auto-detectado do CSV) | `{ periodo, totais, faltantes[], divergencia_valor[], divergencia_competencia[], extras[] }` |
| (reuso) | `/api/espiao/importar-lote` | `id_empresa`, `chaves[]` (as faltantes) | baixa+manifesta XML |
| (reuso) | `/api/xml-injector/parse` + `injetar-grupos` | XML das faltantes | injeta no SPED |

Backend novo: `backend/services/conciliacaoService.js` (`parseSefazCsv`, `conciliar`). Encoding do CSV: **latin1** (padrão SEFAZ/BA), igual ao HTML.

---

## 7. Fases

- **FASE 1 — MVP CSV × Banco (sem certificado).** Endpoint `/api/conciliacao/sefaz-csv` + painel de 4 baldes na UI. Entrega já o que dói: "está na SEFAZ e não na minha escrituração". *Opção rápida:* reaproveitar o JS de `analyze()` num componente Vue, alimentado por um endpoint que devolve os `documentos_c100` do range — porta menos código, reusa lógica testada.
- **FASE 2 — Ações sobre faltantes.** Botões "Baixar XML (EspiãoNFe)" e "Injetar XML local" ligando nos serviços que já existem.
- **FASE 3 — Convergência.** Unificar com o motor do plano EspiãoNFe: CSV e API viram fontes intercambiáveis de `conciliar()`. Remover duplicações de rota (ver Problema 2 do outro plano).

---

## 8. Decisões em aberto (para o Esmael)

1. **Escopo agora:** só FASE 1 (CSV×banco, rápido) ou já mirar a convergência FASE 3?
2. **Local na UI:** MdeView (convergente) ou aba nova no Analisador (amarrada a 1 arquivo)?
3. **Parse do CSV:** server-side (reusa para o EspiãoNFe; recomendado) ou client-side (porta o JS atual mais rápido)?
4. **Formato do CSV:** confirmar se é sempre a "Relação de NF-e Destinadas" do portal SEFAZ-BA (cabeçalhos), ou se há variações a suportar.

---

*Plano aguardando aprovação. Nenhuma alteração foi feita no código.*
