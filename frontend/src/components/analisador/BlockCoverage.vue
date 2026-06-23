<script setup>
defineProps({
  blocks: {
    type: Array,
    required: true
    // Array<{ code: string, status: 'conforme'|'variacao'|'lacre' }>
  }
})

const dotColor = (s) => ({
  conforme: 'bg-conforme',
  variacao: 'bg-variacao',
  lacre: 'bg-lacre',
}[s] ?? 'bg-risco')
</script>

<template>
  <div>
    <div class="text-[11px] tracking-[.08em] uppercase text-risco font-medium">
      Cobertura por bloco SPED
    </div>
    <div class="flex flex-wrap gap-[7px] mt-[9px]">
      <div
        v-for="b in blocks"
        :key="b.code"
        class="w-[42px] h-[42px] rounded-[4px] bg-sheet border border-line flex flex-col items-center justify-center gap-[3px]"
      >
        <span class="font-mono text-[14px] font-semibold text-ink leading-none">{{ b.code }}</span>
        <span class="w-[6px] h-[6px] rounded-full block" :class="dotColor(b.status)"></span>
      </div>
    </div>
  </div>
</template>
