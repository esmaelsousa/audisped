<script setup>
defineProps({
  metrics: {
    type: Array,
    required: true
    // Array<{ label: string, value: string|number, severity?: 'lacre'|'variacao'|'conforme' }>
  }
})

const severityColor = (s) => ({
  lacre: 'text-lacre',
  variacao: 'text-variacao',
  conforme: 'text-conforme',
}[s] ?? 'text-ink')

const severityBg = (s) => ({
  lacre: 'bg-lacre',
  variacao: 'bg-variacao',
  conforme: 'bg-conforme',
}[s] ?? 'bg-transparent')
</script>

<template>
  <div class="flex flex-wrap bg-sheet border border-line rounded-md overflow-hidden">
    <div
      v-for="(m, i) in metrics"
      :key="i"
      class="flex-1 basis-[45%] sm:basis-0 relative px-[18px] py-[14px] border-r border-line last:border-r-0"
      :class="{ 'border-b border-line sm:border-b-0': i < metrics.length - 1 }"
    >
      <!-- tarja de severidade -->
      <span
        v-if="m.severity"
        class="absolute left-0 top-0 bottom-0 w-[3px]"
        :class="severityBg(m.severity)"
      ></span>

      <div
        class="font-mono text-[30px] font-medium leading-none tracking-[-0.02em]"
        :class="m.severity ? severityColor(m.severity) : 'text-ink'"
      >
        {{ m.value }}
      </div>
      <div class="mt-2 text-[11px] tracking-[.08em] uppercase text-risco font-medium">
        {{ m.label }}
      </div>
    </div>
  </div>
</template>
