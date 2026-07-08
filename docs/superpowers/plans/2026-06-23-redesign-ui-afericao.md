# Redesign "Aferição" — Fatia 1 (Login + Casca + Analisador) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trazer o design "Aferição" para o app Vue real, cobrindo a fatia **Login + casca (shell) + Analisador**, de forma responsiva e reversível, para validação no localhost.

**Architecture:** Sistema de tokens "Aferição" em `src/style.css` (Tailwind 4 CSS-first `@theme`) + Google Fonts. Casca reconstruída (`App.vue` + componentes `AppSidebar`/`AppTopbar`) com drawer responsivo. Componentes de apresentação reutilizáveis (`MetricRuler`, `TotalizerGauge`, `BlockCoverage`, `OccurrenceTable`) que a `AnalisadorView` consome, preservando a lógica/dados existentes. Tudo numa **git worktree isolada** (branch `feat/redesign-ui`); nada vai para a VPS até aprovação do cliente.

**Tech Stack:** Vue 3 (`<script setup>`), Tailwind 4 (`@theme` em CSS, sem `tailwind.config.js`), `lucide-vue-next`, Vite 6, `src/store.js` (refs reativas globais).

**Referência visual (fonte da verdade):** `scratchpad/mock_afericao.html` — paleta, tipografia, espaçamentos, radius, e a marcação exata de cada componente. Sempre conferir contra esse arquivo.

## Global Constraints

- **100% responsivo (mobile→desktop):** sidebar vira drawer/hambúrguer abaixo de 880px; tabelas densas com scroll horizontal (min-width) ou reflow; alvos de toque ≥40px; breakpoints Tailwind `sm/md/lg`; foco de teclado visível; respeitar `prefers-reduced-motion`.
- **Sem cara de IA:** acento ÚNICO bronze `#A8631F` (NUNCA o `#2563EB` atual); radius único `6px`; severidade = **tarja de 3px na borda esquerda** (nunca pílula); dados/números em **IBM Plex Mono `tabular-nums`**; **zero** emoji decorativo, gradiente, glassmorphism, ilustração de estado vazio.
- **Tipografia:** Familjen Grotesk (display: títulos, rótulos-instrumento, dígito-totalizador) · Inter (corpo/UI) · IBM Plex Mono (dados). Escala 1.200 ancorada em 13px.
- **Reversível:** todo o trabalho na worktree/branch `feat/redesign-ui`. A migração de tokens é global (reskina o app inteiro de imediato); telas ainda não migradas continuam funcionando com reskin parcial.
- **Verificação de CADA tarefa (substitui o ciclo TDD para trabalho visual):**
  1. `cd frontend && npm run build` conclui SEM erro.
  2. `npm run dev` no ar; screenshot via Chrome headless em **1440px (desktop)** e **414px (mobile)**, conferido contra `mock_afericao.html`.
  3. Sem erros no console do navegador.
  4. Commit.

  Comando de screenshot (macOS, Chrome headless; `perl alarm` como guarda de tempo):
  ```bash
  CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  perl -e 'alarm shift @ARGV; exec @ARGV' 35 "$CHROME" --headless=new --disable-gpu \
    --hide-scrollbars --no-sandbox --user-data-dir="$(mktemp -d)" --force-device-scale-factor=2 \
    --window-size=1440,1180 --virtual-time-budget=4500 \
    --screenshot=/tmp/shot_desktop.png "http://localhost:5173/analisador"
  ```

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `frontend/src/style.css` (modificar) | Tokens `@theme` Aferição + import de fontes + base styles (radius, foco, reduced-motion) |
| `frontend/index.html` (modificar) | `<link>` preconnect + Google Fonts (Familjen Grotesk, Inter, IBM Plex Mono) |
| `frontend/src/components/ui/UiButton.vue` (criar) | Botão primário/secundário no sistema (bronze, radius 6px) |
| `frontend/src/components/ui/UiSelo.vue` (criar) | Selo retangular (origem/estado): de-para, fiscal, apuração, auto, harvest |
| `frontend/src/components/shell/AppSidebar.vue` (criar) | Sidebar grafite: marca, nav agrupada por verbo fiscal, item ativo bronze, bloco Cliente Ativo |
| `frontend/src/components/shell/AppTopbar.vue` (criar) | Topbar "régua de contexto": empresa·CNPJ·período·leiaute + status global + botão hambúrguer |
| `frontend/src/App.vue` (modificar) | Casca responsiva: layout sidebar+main, drawer mobile (estado aberto/scrim) |
| `frontend/src/views/LoginView.vue` (modificar) | Login reconstruído no novo sistema (identidade Aferição) |
| `frontend/src/components/analisador/MetricRuler.vue` (criar) | Régua de métricas (Ocorrências/Bloqueantes/Advertências/Regras) |
| `frontend/src/components/analisador/TotalizerGauge.vue` (criar) | **Assinatura**: totalizador + agulha de tolerância (só grandeza com tolerância real) |
| `frontend/src/components/analisador/BlockCoverage.vue` (criar) | Chips de cobertura por bloco SPED (0/C/D/E/G/H/K/1/9) com ponto de status |
| `frontend/src/components/analisador/OccurrenceTable.vue` (criar) | Tabela de ocorrências: tarja-lacre, diff antes→depois, selo origem, expansão |
| `frontend/src/views/AnalisadorView.vue` (modificar) | Adota tokens + componentes na seção principal de resultados, preservando lógica/dados |

---

### Task 0: Worktree isolada + baseline

**Files:** nenhum alterado (setup).

- [ ] **Step 1:** Criar worktree isolada via skill `superpowers:using-git-worktrees`, branch `feat/redesign-ui` a partir do HEAD atual. (As mudanças não commitadas do Validador ficam intactas no working tree principal.)

- [ ] **Step 2:** Na worktree, instalar deps e subir o dev server:
```bash
cd frontend && npm install && npm run dev
```
Expected: Vite sobe em `http://localhost:5173` e o app atual renderiza (login).

- [ ] **Step 3:** Screenshot baseline desktop+mobile (estado ANTES) para comparação. Salvar em `/tmp/baseline_*.png`.

---

### Task 1: Fundação — tokens Aferição + fontes

**Files:**
- Modify: `frontend/index.html` (head)
- Modify: `frontend/src/style.css`

**Interfaces:**
- Produces: variáveis de tema usadas por TODOS os componentes — cores `--color-graphite #1C232A`, `--color-paper #F3F5F4`, `--color-sheet #FFFFFF`, `--color-bronze #A8631F`, `--color-green #3C7B58`, `--color-amber #B5840F`, `--color-red #AE3A33`, `--color-ink #121820`, `--color-risco #646E6A`, `--color-line #E2E6E4`; radius `--radius 6px`; famílias `--font-display`, `--font-body`, `--font-mono`. Em Tailwind 4 os tokens `@theme` viram utilitários (`bg-graphite`, `text-bronze`, `font-mono`, etc.).

- [ ] **Step 1:** Em `frontend/index.html`, dentro de `<head>`, adicionar preconnect + a fonte (copiar os 2 `<link rel="preconnect">` e o `<link href="...Familjen+Grotesk...Inter...IBM+Plex+Mono...">` exatamente como em `mock_afericao.html`).

- [ ] **Step 2:** Em `frontend/src/style.css`, dentro do bloco `@theme`, definir os tokens (substituindo `naval`/`brand-accent`/`brand-surface`/`platinum` pelos novos):
```css
@theme {
  --color-graphite: #1C232A;
  --color-graphite-2: #232C35;
  --color-paper: #F3F5F4;
  --color-sheet: #FFFFFF;
  --color-bronze: #A8631F;
  --color-conforme: #3C7B58;
  --color-variacao: #B5840F;
  --color-lacre: #AE3A33;
  --color-ink: #121820;
  --color-risco: #646E6A;
  --color-line: #E2E6E4;
  --radius: 6px;
  --font-display: "Familjen Grotesk", system-ui, sans-serif;
  --font-body: "Inter", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, monospace;
}
```

- [ ] **Step 3:** Ainda em `style.css`, base styles globais:
```css
body { font-family: var(--font-body); background: var(--color-paper); color: var(--color-ink); }
.font-mono, [class*="mono"] { font-variant-numeric: tabular-nums; }
:focus-visible { outline: 2px solid var(--color-bronze); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
```

- [ ] **Step 4 (verificar):** `npm run build` sem erro; `npm run dev`; screenshot. Esperado: fundo papel `#F3F5F4`, fontes carregadas, qualquer botão `brand-accent` antigo agora aparece... (nota: classes hardcoded `bg-[#...]` antigas não mudam — esperado; serão migradas nas telas).

- [ ] **Step 5 (commit):**
```bash
git add frontend/index.html frontend/src/style.css
git commit -m "feat(redesign): tokens e fontes do sistema Aferição"
```

---

### Task 2: Primitivos de UI (UiButton, UiSelo)

**Files:**
- Create: `frontend/src/components/ui/UiButton.vue`
- Create: `frontend/src/components/ui/UiSelo.vue`

**Interfaces:**
- Produces:
  - `<UiButton variant="primary|ghost" icon?>` — primary = `bg-bronze text-white rounded-[--radius]`; ghost = borda `line`. Slot default = label.
  - `<UiSelo tipo="de-para|fiscal|apuracao|auto|harvest|manual">` — selo retangular 9px UPPERCASE mono, borda `line`, radius 3px. (Ver `.selo` no mock.)

- [ ] **Step 1:** Criar `UiButton.vue` com `<script setup>` (props `variant`, `icon`) e markup/classes espelhando `.btn` do mock (bronze, radius 6px, gap pra ícone lucide 14px stroke 2).

- [ ] **Step 2:** Criar `UiSelo.vue` (prop `tipo`) com as classes de `.selo` (mono 9px uppercase, borda line, radius 3px).

- [ ] **Step 3 (verificar):** Montar os dois numa rota/harness temporária ou import direto numa view simples; `npm run build`; screenshot conferindo contra os selos/botões do mock.

- [ ] **Step 4 (commit):**
```bash
git add frontend/src/components/ui/
git commit -m "feat(redesign): primitivos UiButton e UiSelo"
```

---

### Task 3: AppSidebar.vue

**Files:**
- Create: `frontend/src/components/shell/AppSidebar.vue`

**Interfaces:**
- Consumes: `src/store.js` (`empresaSelecionada`, `usuario`), `vue-router` (rotas), `lucide-vue-next` (ícones).
- Produces: `<AppSidebar />` — largura 240px, `bg-graphite`. Emite `@navigate` (para o App.vue fechar o drawer no mobile ao clicar num item).

- [ ] **Step 1:** Criar `AppSidebar.vue` espelhando `.side`/`.brand`/`.nav`/`.client` do mock:
  - Marca "AudiSped" (quadrado bronze + nome em `font-display`).
  - Nav agrupada por verbo: **CONFERIR** (Analisador, Validador, Conciliação SEFAZ), **CORRIGIR** (Injetor XML, Regras Fiscais, LMC), **TRANSMITIR** (Exportar SPED, MDe) — usar `RouterLink` com `active-class` que aplica borda-esquerda bronze 2px + texto bronze + fundo `bronze/8%`.
  - Bloco "Cliente Ativo" no rodapé: razão social (`font-display`), CNPJ + competência (`font-mono`), lidos de `empresaSelecionada`/`arquivoInfo` do store.
  - Ícones `lucide-vue-next` 15px stroke 1.6.

- [ ] **Step 2:** Emitir `navigate` no `@click` de cada item (para o drawer mobile).

- [ ] **Step 3 (verificar):** `npm run build`; screenshot da sidebar (desktop) contra o mock.

- [ ] **Step 4 (commit):**
```bash
git add frontend/src/components/shell/AppSidebar.vue
git commit -m "feat(redesign): AppSidebar (casca grafite, nav por verbo fiscal)"
```

---

### Task 4: AppTopbar.vue (régua de contexto)

**Files:**
- Create: `frontend/src/components/shell/AppTopbar.vue`

**Interfaces:**
- Consumes: `store.js` (`empresaSelecionada`, `arquivoInfo`).
- Produces: `<AppTopbar @toggle-menu />` — altura 48px, `bg-sheet`, segmentos empresa·CNPJ·período·leiaute separados por borda; status global à direita; botão hambúrguer (visível só <880px) que emite `toggle-menu`.

- [ ] **Step 1:** Criar `AppTopbar.vue` espelhando `.top`/`.ctx`/`.pend`/`.burger` do mock. Segmentos com classe que some no mobile (`hidden md:flex`). CNPJ/período/leiaute em `font-mono`. Status "N PENDÊNCIAS" em `text-lacre` (placeholder até ligar a contagem real).

- [ ] **Step 2 (verificar):** `npm run build`; screenshot desktop (régua completa) e mobile (só empresa + hambúrguer + status).

- [ ] **Step 3 (commit):**
```bash
git add frontend/src/components/shell/AppTopbar.vue
git commit -m "feat(redesign): AppTopbar regua de contexto + hamburguer"
```

---

### Task 5: App.vue — casca responsiva (drawer)

**Files:**
- Modify: `frontend/src/App.vue`

**Interfaces:**
- Consumes: `AppSidebar`, `AppTopbar`, `token` do store (para mostrar a casca só logado).
- Produces: layout final — `flex`, sidebar sticky no desktop; abaixo de 880px a sidebar vira `fixed` com `translateX(-100%)` e classe `open` (controlada por ref) + scrim. `<RouterView>` na área de conteúdo (`bg-paper`, scroll próprio).

- [ ] **Step 1:** Reescrever o `<template>` do `App.vue`: scrim + `<AppSidebar :class="{open: menuOpen}">` + `<main>` com `<AppTopbar @toggle-menu="menuOpen=!menuOpen">` e `<RouterView>`. `ref menuOpen=false`; fechar no `@navigate` da sidebar e ao clicar no scrim.

- [ ] **Step 2:** CSS responsivo (`<style>` ou classes) espelhando o `@media(max-width:880px)` do mock (sidebar fixed/translate, scrim, burger visível).

- [ ] **Step 3 (verificar):** `npm run build`; screenshot **desktop** (sidebar fixa + topbar) e **mobile** (sidebar escondida, hambúrguer abre o drawer com scrim). Testar foco/teclado no toggle.

- [ ] **Step 4 (commit):**
```bash
git add frontend/src/App.vue
git commit -m "feat(redesign): casca responsiva com drawer mobile"
```

---

### Task 6: LoginView no sistema Aferição

**Files:**
- Modify: `frontend/src/views/LoginView.vue`

**Interfaces:**
- Consumes: tokens, `UiButton`. Mantém a lógica de auth existente (chamada `/api/auth/login`, store do token) — só troca a apresentação.

- [ ] **Step 1:** Reestilizar o LoginView: fundo `paper`, cartão `sheet` com borda `line` e radius 6px (sem `rounded-2xl/3xl`, sem `font-black tracking-widest`, sem gradiente — remover os tells de IA). Título em `font-display`, marca AudiSped, inputs com borda `line`/foco bronze, `<UiButton>` "Entrar". Sem emoji.

- [ ] **Step 2 (verificar):** `npm run build`; screenshot desktop + mobile. Login ainda autentica (testar fluxo com usuário real local).

- [ ] **Step 3 (commit):**
```bash
git add frontend/src/views/LoginView.vue
git commit -m "feat(redesign): LoginView no sistema Afericao"
```

---

### Task 7: Componentes de apresentação do Analisador

**Files:**
- Create: `frontend/src/components/analisador/MetricRuler.vue`
- Create: `frontend/src/components/analisador/TotalizerGauge.vue`
- Create: `frontend/src/components/analisador/BlockCoverage.vue`
- Create: `frontend/src/components/analisador/OccurrenceTable.vue`

**Interfaces (props):**
- `<MetricRuler :metrics="[{label,value,severity?}]" />` — régua `.ruler`/`.met` do mock; `severity` em {`lacre`,`variacao`,`conforme`} aplica cor+tarja.
- `<TotalizerGauge label value :min :max :limit />` — **assinatura**: dígitos mono sobre faixa grafite + barra-agulha (`.totbox`/`.digits`/`.gauge`). Usar SÓ para grandeza com tolerância real (variação ANP, % estoque). Posição da agulha = `value/limit`.
- `<BlockCoverage :blocks="[{code,status}]" />` — chips `.chip` com ponto verde/âmbar/vermelho.
- `<OccurrenceTable :rows="[{severity,registro,campo,from?,to,origem}]" />` — tabela `.sheet`/`table` do mock: `td.sev` com `.tarja`, diff `from`(riscado lacre)→`to`(conforme), `<UiSelo :tipo="origem">`, chevron lucide, scroll horizontal (`min-width:760px`), header sticky. Rodapé `.foot` com `<slot name="footer">`.

- [ ] **Step 1:** Criar os 4 componentes copiando a marcação/CSS correspondente de `mock_afericao.html`, parametrizando via props (sem dados hardcoded).

- [ ] **Step 2 (verificar):** Renderizar os 4 com dados de exemplo numa rota/harness; `npm run build`; screenshot desktop+mobile (a tabela rola no mobile; régua quebra em 2 colunas). Comparar com o mock.

- [ ] **Step 3 (commit):**
```bash
git add frontend/src/components/analisador/
git commit -m "feat(redesign): componentes do Analisador (regua, totalizador, cobertura, ocorrencias)"
```

---

### Task 8: Integrar na AnalisadorView (seção principal)

**Files:**
- Modify: `frontend/src/views/AnalisadorView.vue`

**Interfaces:**
- Consumes: `MetricRuler`, `TotalizerGauge`, `BlockCoverage`, `OccurrenceTable`, `AppTopbar` (já na casca). Liga os dados REAIS já existentes na view (contagens de ocorrências/erros, cobertura por bloco, lista de correções/diffs) aos props dos componentes. **Não reescrever a lógica** — apenas mapear os dados existentes para os props e substituir a marcação visual da seção principal de resultados.

- [ ] **Step 1:** Identificar na `AnalisadorView.vue` a fonte de dados da seção de resultados (ocorrências/erros, contadores, cobertura). Mapear para os formatos dos props da Task 7 via `computed`.

- [ ] **Step 2:** Substituir a marcação da seção principal (cabeçalho da tela em `font-display` + `<MetricRuler>` + `<TotalizerGauge>` para variação ANP quando houver + `<BlockCoverage>` + `<OccurrenceTable>`). Manter as demais abas/seções funcionando (reskin parcial herdado dos tokens; polimento fino fica para o plano seguinte).

- [ ] **Step 3 (verificar):** `npm run build`; abrir `/analisador` com um arquivo real local; screenshot desktop+mobile conferindo contra `mock_afericao.html`; sem erro no console; os números batem com os dados reais.

- [ ] **Step 4 (commit):**
```bash
git add frontend/src/views/AnalisadorView.vue
git commit -m "feat(redesign): AnalisadorView adota o sistema Afericao na secao de resultados"
```

---

### Task 9: Revisão da fatia + aprovação do cliente

- [ ] **Step 1:** Rodar a fatia completa no localhost; screenshots finais de Login, casca e Analisador em **desktop e mobile**.
- [ ] **Step 2:** Apresentar ao cliente para validação. Se aprovado → planejar rollout das demais telas (plano seguinte) e, só então, deploy na VPS. Se reprovado → ajustar ou descartar a branch (reversível).

---

## Self-Review (preenchido)

- **Cobertura do spec:** fatia Login (Task 6) + casca/shell (Tasks 3-5) + Analisador (Tasks 7-8); fundação (Task 1-2); responsividade (Global Constraints + verificação mobile em cada task); reversibilidade (Task 0 worktree). ✔
- **Placeholders:** tokens e interfaces de componentes definidos com valores exatos; markup detalhado referenciado em `mock_afericao.html` (artefato concreto, não placeholder). "N PENDÊNCIAS" do topbar é placeholder explícito até ligar a contagem real na Task 8.
- **Consistência de tipos:** nomes de props (`metrics`, `rows`, `blocks`, `tipo`, `variant`) e tokens (`bronze`, `lacre`, `conforme`, `variacao`) usados de forma consistente entre Task 1, 2 e 7.
- **Escopo:** fatia única e testável; demais ~16 views ficam para um plano de rollout posterior (mencionado na Task 9). Risco anotado: `AnalisadorView.vue` é grande (209KB) — Task 8 restila só a seção principal, sem reescrever a lógica.
