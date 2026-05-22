# PLANO: Ajuste de Estoque LMC — Convergência para Estoque Físico Real

## Objetivo
Permitir que o auditor informe o estoque físico real (medido na régua) e o sistema distribua automaticamente perdas ou ganhos dia a dia no LMC, respeitando o limite ANP de 0,60%, até que o fechamento do último dia do mês convirja ao valor físico informado.

## Problema atual
- O LMC pode ter estoque escritural diferente do estoque físico real.
- Ex: LMC mostra 10.200 L, estoque físico real é 10.000 L (diferença de 200 L).
- Hoje o ajuste é feito manualmente, dia a dia, pelo auditor.

## Solução proposta

### Fluxo do usuário
1. Na página do LMC, seleciona o combustível.
2. Clica no botão **"Convergir para Físico"**.
3. Informa o estoque físico real do último dia do mês (ex: 10.000 L).
4. O sistema exibe um preview:
   - Diferença total: -200 L (perda) ou +200 L (ganho)
   - Distribuição estimada por dia
   - % ANP médio por dia
   - Alerta se não for possível convergir dentro do mês
5. Ao confirmar, o sistema recalcula FECH_FISICO dia a dia.
6. O último dia do mês terá FECH = estoque físico exato informado.

### Lógica de distribuição
- Calcula a diferença: `delta = fisico_real - fech_escritural_ultimo_dia`
- Se `delta < 0`: distribuir PERDA ao longo do mês
- Se `delta > 0`: distribuir GANHO ao longo do mês
- Para cada dia, calcula o máximo permitido: `limite_dia = (ABERT + ENTR) * 0.006`
- Distribui o delta proporcionalmente, sem ultrapassar o limite por dia
- O último dia absorve o resíduo (ajuste fino)

### Regras de segurança
- Nunca ultrapassa 0,60% ANP em nenhum dia individual
- Se a diferença for grande demais para resolver em 1 mês, o sistema avisa:
  "Diferença de X litros não pode ser resolvida em 1 mês dentro do limite ANP. Máximo possível: Y litros. Distribua o restante nos meses seguintes."
- Preserva a continuidade: FECH(dia N) = ABERT(dia N+1)
- Não altera VOL_SAIDAS — só ajusta VAL_PERDA / VAL_GANHO e FECH_FISICO

### Campos envolvidos no banco (lmc_movimentacao)
- `fech_fisico_ajustado` — recebe o novo valor calculado
- `val_perda_ajustado` — perda distribuída para o dia
- `val_ganho_ajustado` — ganho distribuído para o dia
- `estq_abert_ajustado` — propagação da cadeia (ABERT = FECH dia anterior)

### Interface (LmcView.vue)
- Botão "Convergir para Físico" ao lado do seletor de combustível
- Modal com:
  - Campo: "Estoque Físico Real (último dia)" — input numérico
  - Preview: tabela com distribuição dia a dia (perda/ganho por dia, % ANP)
  - Indicador: "Possível convergir em X dias" ou alerta de impossibilidade
  - Botões: "Cancelar" / "Aplicar convergência"

### Backend (server.js)
- Nova rota: `POST /api/lmc/convergir-fisico`
  - Body: `{ id_arquivo, cod_item, fisico_real }`
  - Calcula distribuição
  - Retorna preview (sem salvar)
- Nova rota: `POST /api/lmc/confirmar-convergencia`
  - Body: `{ id_arquivo, cod_item, fisico_real }`
  - Aplica os ajustes no banco
  - Retorna resumo

### Impacto em outras funções
- Nenhum impacto na exportação — usa fech_fisico_ajustado normalmente
- Nenhum impacto na análise — os ajustes aparecem como dados do banco
- Compatível com o otimizador existente — mesmos campos

## Prioridade
A definir pelo usuário.

## Estimativa
- Backend: 2 rotas (preview + confirmação)
- Frontend: 1 modal + 1 botão
- Sem alteração no pipeline de exportação
