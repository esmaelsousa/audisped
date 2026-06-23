<script setup>
import { Menu } from 'lucide-vue-next'
import { empresaSelecionada } from '@/store'
import { formatCnpj, competencia, layoutVer } from '@/utils/sped'

defineEmits(['toggle-menu'])
</script>

<template>
  <header class="h-12 flex-shrink-0 flex items-center gap-0 bg-sheet border-b border-line px-[18px] sticky top-0 z-10">

    <!-- Hamburger (mobile only) -->
    <button
      @click="$emit('toggle-menu')"
      class="md:hidden bg-transparent border-0 text-ink p-[6px] mr-[6px] cursor-pointer flex items-center"
      aria-label="Menu"
    >
      <Menu :size="22" :stroke-width="1.8" />
    </button>

    <!-- Regua de contexto -->
    <div class="flex items-center gap-0 min-w-0 overflow-hidden flex-1">
      <!-- Empresa — always visible -->
      <div v-if="empresaSelecionada" class="flex flex-col justify-center px-[14px] border-r border-line whitespace-nowrap first:pl-0 pl-0">
        <span class="text-[9px] tracking-[.07em] uppercase text-risco">Empresa</span>
        <span class="text-[13px] font-medium text-ink mt-[1px] truncate max-w-[180px]">
          {{ empresaSelecionada.nome_fantasia || empresaSelecionada.nome_empresa || empresaSelecionada.razao_social || 'Empresa' }}
        </span>
      </div>

      <!-- CNPJ — hidden on mobile -->
      <div v-if="empresaSelecionada" class="hidden md:flex flex-col justify-center px-[14px] border-r border-line whitespace-nowrap">
        <span class="text-[9px] tracking-[.07em] uppercase text-risco">CNPJ</span>
        <span class="font-mono text-[12px] font-medium text-ink mt-[1px]">
          {{ formatCnpj(empresaSelecionada.cnpj) }}
        </span>
      </div>

      <!-- Periodo — hidden on mobile -->
      <div v-if="competencia()" class="hidden md:flex flex-col justify-center px-[14px] border-r border-line whitespace-nowrap">
        <span class="text-[9px] tracking-[.07em] uppercase text-risco">Periodo</span>
        <span class="font-mono text-[12px] font-medium text-ink mt-[1px]">{{ competencia() }}</span>
      </div>

      <!-- Leiaute — hidden on mobile -->
      <div v-if="layoutVer()" class="hidden md:flex flex-col justify-center px-[14px] border-r border-line whitespace-nowrap">
        <span class="text-[9px] tracking-[.07em] uppercase text-risco">Leiaute</span>
        <span class="font-mono text-[12px] font-medium text-ink mt-[1px]">{{ layoutVer() }}</span>
      </div>
    </div>


  </header>
</template>
