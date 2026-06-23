<script setup>
import { computed } from 'vue'

const props = defineProps({
  label: {
    type: String,
    required: true
  },
  value: {
    type: String,
    required: true
    // ex.: "0,48%"
  },
  min: {
    type: Number,
    default: 0
  },
  max: {
    type: Number,
    required: true
  },
  limit: {
    type: Number,
    required: true
  },
  current: {
    type: Number,
    required: true
    // valor numérico para posição da agulha
  }
})

// clamp entre 0 e 100%
const pinPercent = computed(() => {
  const pct = props.limit > 0 ? (props.current / props.limit) * 100 : 0
  return Math.min(Math.max(pct, 0), 100)
})

// Chars do value para o display de dígitos separados por hairline
const chars = computed(() => props.value.split(''))
</script>

<template>
  <div class="bg-graphite text-white px-[18px] py-[13px] flex flex-col justify-center">
    <!-- label -->
    <div class="text-[11px] tracking-[.08em] uppercase font-medium" style="color:#8A949C">
      {{ label }}
    </div>

    <!-- digits display -->
    <div class="inline-flex mt-[6px] border border-white/[.14] rounded-[3px] overflow-hidden w-max">
      <span
        v-for="(ch, i) in chars"
        :key="i"
        class="font-mono text-[26px] font-medium px-[7px] py-[2px] border-r border-white/[.12]"
        :class="i === chars.length - 1 ? 'border-r-0 text-bronze' : 'text-white'"
        style="background:#161D24"
      >{{ ch }}</span>
    </div>

    <!-- gauge bar -->
    <div class="mt-[11px] h-[6px] relative rounded-[3px]" style="background:#2C353E">
      <!-- fill gradiente até o pin -->
      <div
        class="absolute left-0 top-0 bottom-0 rounded-[3px]"
        :style="{
          width: pinPercent + '%',
          background: 'linear-gradient(90deg, rgba(60,123,88,.5), rgba(181,132,15,.55))'
        }"
      ></div>
      <!-- agulha bronze -->
      <div
        class="absolute top-[-4px] bottom-[-4px] w-[2px] bg-bronze"
        :style="{ left: pinPercent + '%' }"
      >
        <span
          class="absolute top-[-3px] left-[-3px] w-[8px] h-[8px] bg-bronze rounded-full block"
        ></span>
      </div>
    </div>

    <!-- legenda min/limit -->
    <div class="flex justify-between mt-[6px] font-mono text-[10px]" style="color:#7E8890">
      <span>{{ min.toFixed(2).replace('.', ',') }}%</span>
      <span>limite {{ limit.toFixed(2).replace('.', ',') }}%</span>
    </div>
  </div>
</template>
