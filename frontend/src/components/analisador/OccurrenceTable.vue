<script setup>
import { ChevronRight } from 'lucide-vue-next'
import UiSelo from '@/components/ui/UiSelo.vue'

defineProps({
  rows: {
    type: Array,
    required: true
    // Array<{
    //   severity: 'lacre'|'variacao'|'conforme',
    //   registro: string,
    //   campo: string,
    //   to: string,             -- descrição da ocorrência/erro
    //   contexto?: string,      -- linha SPED crua (contexto secundário, não diff)
    //   origem: string          -- prefixo real da regra_id (ex: RTAX, CRIT, CAD)
    // }>
  }
})

const tarjaColor = (s) => ({
  lacre: 'bg-lacre',
  variacao: 'bg-variacao',
  conforme: 'bg-conforme',
}[s] ?? 'bg-line')
</script>

<template>
  <div class="bg-sheet border border-line rounded-md overflow-hidden">
    <!-- cabeçalho com slot para botão ou action -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-line">
      <h3 class="font-display text-[14px] font-semibold text-ink">Ocorrências aferidas</h3>
      <slot name="header-action" />
    </div>

    <!-- tabela com scroll horizontal em telas estreitas -->
    <div class="overflow-x-auto">
      <table class="w-full border-collapse text-[13px] min-w-[760px]">
        <thead>
          <tr>
            <th class="w-[4px] p-0 bg-paper border-b border-line"></th>
            <th class="sticky top-0 bg-paper text-left text-[11px] tracking-[.06em] uppercase text-risco font-semibold px-3 py-[9px] border-b border-line">Registro</th>
            <th class="sticky top-0 bg-paper text-left text-[11px] tracking-[.06em] uppercase text-risco font-semibold px-3 py-[9px] border-b border-line">Campo</th>
            <th class="sticky top-0 bg-paper text-left text-[11px] tracking-[.06em] uppercase text-risco font-semibold px-3 py-[9px] border-b border-line">Ocorrência</th>
            <th class="sticky top-0 bg-paper text-left text-[11px] tracking-[.06em] uppercase text-risco font-semibold px-3 py-[9px] border-b border-line">Grupo</th>
            <th class="sticky top-0 bg-paper px-3 py-[9px] border-b border-line w-[32px]"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, i) in rows"
            :key="i"
            :class="i % 2 === 1 ? 'bg-paper' : 'bg-sheet'"
          >
            <!-- tarja de severidade -->
            <td class="p-0 w-[4px]">
              <span
                class="block w-[3px] h-[34px]"
                :class="tarjaColor(row.severity)"
              ></span>
            </td>

            <!-- registro -->
            <td class="px-3 h-[34px] align-middle whitespace-nowrap font-mono font-medium text-ink">
              {{ row.registro }}
            </td>

            <!-- campo -->
            <td class="px-3 h-[34px] align-middle whitespace-nowrap text-risco text-[12px]">
              {{ row.campo }}
            </td>

            <!-- ocorrência: descrição do erro + contexto (linha SPED) como texto secundário -->
            <td class="px-3 h-[34px] align-middle max-w-[360px]">
              <span class="font-mono text-ink font-medium">{{ row.to }}</span>
              <span v-if="row.contexto" class="block font-mono text-[10px] text-risco truncate mt-[1px]" :title="row.contexto">{{ row.contexto }}</span>
            </td>

            <!-- grupo (prefixo real da regra_id) via UiSelo -->
            <td class="px-3 h-[34px] align-middle whitespace-nowrap">
              <UiSelo :tipo="row.origem" />
            </td>

            <!-- chevron -->
            <td class="px-3 h-[34px] align-middle whitespace-nowrap text-right">
              <ChevronRight class="w-[14px] h-[14px] text-risco inline-block" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- footer com slot -->
    <slot name="footer">
      <div class="px-4 py-[10px] border-t border-line font-mono text-[12px] text-risco flex justify-between">
        <span>{{ rows.length }} ocorrência{{ rows.length !== 1 ? 's' : '' }}</span>
      </div>
    </slot>
  </div>
</template>
