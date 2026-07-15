# Cockpit — porta de entrada única (Hub de Cliente + upload + planos)

**Data:** 2026-07-15
**Branch:** `feat/cockpit-hub` (a partir de `feat/controle-usuarios-saas`)
**Status:** design aprovado — pronto para plano de implementação

---

## 1. Contexto e problema

Hoje o fluxo de entrada do AudiSped tem duas telas e uma circularidade:

- `/` → `homeView.vue` ("Gestor de Clientes"): lista/busca/cria/exclui empresas; ao clicar, vai pro Hub.
- `/dashboard/:id` → `DashboardHubView.vue` ("Hub de Operações"): grade estática de 4 cards de módulo; **exige empresa já selecionada** (sem ela, redireciona pra `/`).
- **Upload de SPED** só existe dentro do `AnalisadorView.vue` — mas pra chegar num Analisador útil já é preciso ter carregado um arquivo. Circular.

Além disso, o controle de usuários SaaS (em andamento, `PLANO_CONTROLE_USUARIOS_SAAS.md`) prevê **acesso por módulos**: cada conta contrata um conjunto de módulos e o cliente só deve ver os que são dele (ex.: um posto que só contratou o Validador).

## 2. Objetivo

Fundir as duas telas de entrada numa **cockpit master-detail única** (`/`) que concentra:
- seleção de empresa (lista + busca + criar/excluir),
- **upload de SPED** como ação primária, sempre visível,
- acesso ao **Catálogo de Regras** (global),
- a grade de módulos da empresa selecionada, **filtrada pelo plano** (módulo não contratado aparece bloqueado com upsell).

### Não-objetivos (fora de escopo — ver §9)
- Enforcement de módulo/tenant no **backend** (`requireModule`, `scopeRede`). Fica na Fase 1 do plano SaaS.
- Criação do vínculo `empresas.rede_id` / entitlement **por posto**. A fonte de permissão é abstraída (§5) para trocar depois sem mexer no visual.
- Isolamento tenant da lista de empresas para cliente externo. Hoje só há usuários internos; a lista global está correta para eles.
- Redesenho de qualquer outra tela além do que §8 descreve.

## 3. Decisões aprovadas (pelo usuário)

1. **Fundir** `/` e `/dashboard/:id` numa cockpit master-detail única.
2. **Pós-upload:** ao concluir, navega para `/analisador/:id` e roda a análise — reaproveita 100% do fluxo atual.
3. **Escopo dos módulos:** 5 cards por empresa (Analisador, Validador SPED, Livro LMC, Injetor de XMLs, Gestão de SPEDs) + **Catálogo de Regras** global fixo no rodapé do rail.
4. **Fonte do plano:** abstraída em `modulosPermitidos`. Hoje = usuário logado (`usuario.modulos`, já vem no `/api/auth/me`; papéis internos veem tudo). Depois = plano do posto, quando a Fase 1 ligar `empresas.rede_id` — **sem tocar no visual**.
5. **Módulo não contratado:** aparece **bloqueado** (cadeado + "Não incluído no seu plano — fale com o suporte"), não some. Vira vitrine de upsell.

## 4. Arquitetura

### Rotas (`frontend/src/router/index.js`)
- Nova view **`CockpitView.vue`** na rota `/`, substituindo `homeView.vue`.
- `/dashboard/:id` → **redireciona** para `/?empresa=:id` (pré-seleciona a empresa no cockpit). Nenhum link/atalho existente quebra.
- `DashboardHubView.vue` é aposentada (permanece no histórico do git).
- `AppSidebar.vue`: os links "Empresas" e "Hub do Cliente" reconciliados para o cockpit (o "Hub do Cliente" passa a apontar `/?empresa=<id da empresa selecionada>`).

### Estado (`frontend/src/store.js`)
- Continua usando os refs existentes: `empresaSelecionada`, `arquivoInfo`, `usuario`.
- Nenhuma mudança de contrato no store. `CockpitView` lê `usuario.modulos` (já populado no boot via `/api/auth/me`).

### Componentes
`CockpitView.vue` composto por (extrair subcomponentes se o arquivo crescer demais):
- **`CockpitRail`** — busca + botão "Nova empresa" + lista de clientes + rodapé (Catálogo + contador). Reusa `carregarEmpresas`, `empresasFiltradas`, `selecionarEmpresa`, e os modais de criar/excluir de `homeView.vue` (migrados 1:1).
- **`CockpitDropzone`** — zona de upload (drag & drop + clique). Reusa a lógica de `AnalisadorView.vue`: `handleSpedFile → verificarSequenciaPeriodo → executarUpload` (`POST /api/upload`, campo `spedfile`, tratamento 409/sobrescrever e modal de sequência). No sucesso: `setArquivoInfo` + `setEmpresaSelecionada` e `router.push('/analisador/'+id)`.
- **`CockpitModulos`** — grade dos 5 módulos, dirigida por entitlement (§5).

> A lógica de upload hoje vive embutida em `AnalisadorView.vue`. Para não duplicar, extrair as funções de upload (`handleSpedFile`, `verificarSequenciaPeriodo`, `executarUpload`) para um composable **`useUploadSped.js`** consumido tanto pelo Cockpit quanto pelo Analisador. Isso é uma melhoria de fronteira dentro do escopo (evita duas cópias divergentes do fluxo de upload).

## 5. Camada de entitlement (o coração do gating)

### Catálogo de módulos (fonte única)

> **⚠️ Classificação PROVISÓRIA — a definir pelo usuário no futuro.** A divisão core vs sellable
> abaixo (e quais módulos entram em quais planos) é uma **decisão de negócio ainda em aberto**.
> O cockpit é deliberadamente **agnóstico** a ela: lê a tabela de `frontend/src/config/modulos.js`.
> Redefinir a classificação depois = editar esse arquivo (uma linha por chave), **sem tocar na UI**.
> Os valores abaixo são apenas o default de partida, espelhando o catálogo do plano SaaS atual.

As chaves seguem o catálogo canônico do plano SaaS (`PLANO_CONTROLE_USUARIOS_SAAS.md §2.6`, a virar `backend/modulos.js` na Fase 1):

| Card do cockpit    | chave         | categoria |
|--------------------|---------------|-----------|
| Analisador         | `analisador`  | **core**  |
| Catálogo de Regras | `catalogo`    | **core**  |
| Validador SPED     | `validador`   | sellable  |
| Livro LMC          | `livro_lmc`   | sellable  |
| Injetor de XMLs    | `injetor_xml` | sellable  |
| Gestão de SPEDs    | *(core — repositório de arquivos, sempre disponível p/ conta ativa)* | core |

- **core** = sempre visível para conta ativa. **sellable** = só se contratado.
- Consequência importante: um posto "só Validador" ainda vê **Analisador + Catálogo + Gestão de SPEDs** (core) e o **Validador**; ficam bloqueados apenas os demais *sellable* (ex.: Injetor XML). O motor base é grátis; o Validador é o add-on.

### Regra de permissão
```
modulosPermitidos =
  isInterno(usuario)                       ? TODAS as chaves do catálogo
                                           : core ∪ (usuario.modulos ∩ sellable)
```
- `isInterno` = role ∈ {`super_admin`, `staff`} (rede_id NULL). Interno vê tudo.
- Enquanto `backend/modulos.js` não existe, o cockpit carrega o catálogo de um **arquivo espelho no front** (`frontend/src/config/modulos.js`) com a mesma tabela acima. Quando a Fase 1 publicar o catálogo do backend (ex.: exposto no `/api/auth/me` ou endpoint próprio), o front passa a consumi-lo — o espelho vira fallback.

### Renderização
- Card com chave ∈ `modulosPermitidos` → card normal, clicável (`router.push` pra rota do módulo).
- Card fora → **card bloqueado**: esmaecido, ícone neutro, pílula "Não incluído" com cadeado, rodapé "Não incluído no seu plano — fale com o suporte", **não clicável**. Ordem canônica preservada (layout estável).
- Card `livro_lmc` permitido mas **sem SPED carregado** (`!arquivoInfo`) → mantém o aviso atual "Requer SPED carregado" (âmbar), não confundir com bloqueio de plano.

### Guarda de rota (presentacional)
- O router (`beforeEach`) ganha uma checagem leve: se a rota é de um módulo *sellable* e a chave ∉ `modulosPermitidos`, redireciona pro cockpit com um aviso. Isso é **UX/consistência**, não segurança — deep-link continua tecnicamente acessível até o backend implementar `requireModule` (§9). Registrado explicitamente para não haver ilusão de trava.

## 6. Fluxo de upload (reuso, sem reimplementar)
Idêntico ao atual, apenas iniciado do cockpit:
1. `handleSpedFile(file)` → `verificarSequenciaPeriodo` (modal se fora de sequência) → `executarUpload`.
2. `POST /api/upload` (FormData `spedfile`, `onUploadProgress`), tratamento **409** (sobrescrever `?overwrite=true` / reparo físico).
3. Resposta grava store (`setArquivoInfo`, `setEmpresaSelecionada`) e `router.push('/analisador/'+id_sped_arquivo)` → `runAnalysis` roda no Analisador como hoje.
4. SSE de logs permanece no Analisador (não é replicado no cockpit).

## 7. Layout e responsivo

**Desktop (≥ 880px):** duas colunas — rail (~300px) + área principal (upload no topo, cabeçalho do cliente, grade de módulos). Sem empresa selecionada: estado de boas-vindas com a dropzone protagonista.

**Mobile/tablet (< 880px):** o rail vira seletor no topo (empresa atual + "trocar cliente" abrindo a lista em drawer); área principal empilha; grade de módulos em coluna única. Breakpoint unificado `--breakpoint-md: 880px` (o mesmo do resto do app).

Referência visual aprovada: `MOCKUP_Cockpit.html` (mockup estático fiel, com os 3 estados: plano completo / plano restrito / boas-vindas).

## 8. Direção visual
Sistema **Aferição** existente — sem cor/hex novos, sem emoji, sem gradiente, sem cara de template. Tokens de `frontend/src/style.css` (`--color-bronze #A8631F`, `--color-ink`, `--color-paper`, `--font-display` Familjen Grotesk, radius 6px). Ícones `lucide-vue-next` (os componentes reais, não os SVGs do mockup). Selos via `UiSelo.vue`, botões via `UiButton.vue`. Densidade e microtipografia iguais às telas atuais.

## 9. Fora de escopo — dependências no plano SaaS
Estes itens **não** entram neste trabalho; a abstração `modulosPermitidos` é o que permite plugá-los depois barato:
- **Enforcement backend** (`requireModule`, `scopeRede`, ownership-check por objeto) — Fase 1 do `PLANO_CONTROLE_USUARIOS_SAAS.md`. **Sem isso, o gating do cockpit é só visual.** Aceitável hoje: só usuários internos usam o sistema (cliente externo não liberado antes da Fase 1 de isolamento).
- **`empresas.rede_id`** e entitlement **por posto** — quando existir, `modulosPermitidos` troca de fonte (usuário → posto) sem mudança de UI.
- **Isolamento tenant** da lista de empresas para cliente externo.

## 10. Riscos e mitigações
- **Divergência de upload** (duas cópias do fluxo) → mitigado pelo composable `useUploadSped.js` (§4).
- **Ilusão de segurança** (bloqueio só visual) → documentado aqui e no código; guarda de rota marcada como presentacional.
- **Chaves de módulo erradas** → tabela §5 espelha o catálogo canônico do plano; validar contra `backend/modulos.js` quando existir.
- **Trabalho no branch errado** → mitigado: branch dedicado `feat/cockpit-hub` a partir de `feat/controle-usuarios-saas` (herda a fundação SaaS).
- **Quebra de links `/dashboard/:id`** → mitigado pelo redirect que preserva o `:id`.

## 11. Critérios de aceite
1. `/` renderiza o cockpit master-detail; `/dashboard/:id` redireciona pra `/?empresa=:id` com a empresa pré-selecionada.
2. Upload de um `.txt` SPED no cockpit sobe o arquivo e leva ao `/analisador/:id` com a análise rodando (paridade com o fluxo atual, incluindo 409/sequência).
3. Lista de empresas: busca, criar e excluir funcionam como em `homeView` (modais migrados).
4. Catálogo de Regras acessível pelo rodapé do rail.
5. Grade de módulos reflete `modulosPermitidos`: para usuário interno, os 5 aparecem ativos; simulando um `usuario.modulos` restrito (ex.: `['validador']`), os *sellable* não contratados aparecem **bloqueados** com o texto de upsell, enquanto os *core* seguem ativos.
6. Responsivo < 880px: rail vira drawer, conteúdo empilha, sem scroll horizontal.
7. `DashboardHubView.vue` não é mais alcançável por rota; suíte de testes existente segue verde.

## 12. Arquivos afetados
- **Novos:** `frontend/src/views/CockpitView.vue`, `frontend/src/components/cockpit/{CockpitRail,CockpitDropzone,CockpitModulos}.vue`, `frontend/src/composables/useUploadSped.js`, `frontend/src/config/modulos.js`.
- **Alterados:** `frontend/src/router/index.js` (rota `/`, redirect `/dashboard/:id`, guarda de módulo), `frontend/src/components/shell/AppSidebar.vue` (links), `frontend/src/views/AnalisadorView.vue` (passa a usar `useUploadSped`).
- **Aposentados:** `frontend/src/views/homeView.vue`, `frontend/src/views/DashboardHubView.vue` (removidos das rotas; ficam no histórico).
