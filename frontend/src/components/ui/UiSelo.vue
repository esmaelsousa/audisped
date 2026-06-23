<script setup>
defineProps({
  tipo: {
    type: String,
    required: true
  }
})
</script>

<template>
  <span class="font-mono text-[9px] tracking-[.05em] uppercase text-risco border border-line px-[6px] py-[2px] rounded-[3px]">
    {{ tipo }}
  </span>
</template>
