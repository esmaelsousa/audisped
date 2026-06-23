<script setup>
defineProps({
  variant: {
    type: String,
    default: 'primary',
    validator: (v) => ['primary', 'ghost'].includes(v)
  }
})
</script>

<template>
  <button
    :class="[
      'inline-flex items-center gap-[7px] rounded-md text-[13px] font-medium cursor-pointer border-0 transition-opacity hover:opacity-85',
      variant === 'primary'
        ? 'bg-bronze text-white px-[13px] py-[7px]'
        : 'bg-transparent text-ink border border-line px-[13px] py-[7px] hover:bg-line/50'
    ]"
  >
    <slot />
  </button>
</template>
