<script setup>
import { computed } from 'vue'
import { paywallVisivel, fecharPaywall } from '../store'

// WhatsApp do comercial AudiSped (74) 99198-5228 → formato internacional 55 74 9 9198 5228
const WHATS_NUMERO = '5574991985228'
const WHATS_TEXTO = 'Olá! Testei a demonstração do AudiSped e quero contratar o sistema para gerar meus arquivos corrigidos (SPED / LMC).'

const whatsappUrl = computed(
  () => `https://wa.me/${WHATS_NUMERO}?text=${encodeURIComponent(WHATS_TEXTO)}`
)
</script>

<template>
  <Transition name="fade">
    <div
      v-if="paywallVisivel"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/60"
      @click.self="fecharPaywall"
    >
      <div class="w-full max-w-md rounded-2xl bg-sheet shadow-2xl overflow-hidden">
        <!-- Cabeçalho -->
        <div class="px-6 pt-6 pb-4 text-center">
          <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-bronze/10">
            <svg class="h-7 w-7 text-bronze" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
          </div>
          <h2 class="text-xl font-semibold text-ink">Recurso exclusivo para assinantes</h2>
          <p class="mt-2 text-sm leading-relaxed text-muted">
            Você está no <strong>ambiente de demonstração</strong>. Aqui dá para testar tudo —
            validar, corrigir o LMC, ver o que foi ajustado — mas o <strong>download do arquivo
            corrigido</strong> é liberado apenas para assinantes do AudiSped.
          </p>
        </div>

        <!-- CTA -->
        <div class="px-6 pb-6 space-y-3">
          <a
            :href="whatsappUrl"
            target="_blank"
            rel="noopener"
            class="flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 py-3 font-semibold text-white shadow-sm transition hover:brightness-95"
          >
            <svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.002-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            Contratar pelo WhatsApp
          </a>
          <p class="text-center text-xs text-muted">
            Fale com o comercial: <strong>(74) 99198-5228</strong>
          </p>
          <button
            type="button"
            class="w-full rounded-xl px-4 py-2.5 text-sm font-medium text-muted transition hover:bg-paper"
            @click="fecharPaywall"
          >
            Continuar testando
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.18s ease-out; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
