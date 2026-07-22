<script setup>
import { ref, computed, onMounted } from 'vue'
import axios from 'axios'
import { API_BASE_URL } from '../api'
import { useRouter, useRoute } from 'vue-router'
import {
  empresaSelecionada, arquivoInfo, usuario,
  setEmpresaSelecionada, setArquivoInfo, setIdArquivoSped,
} from '../store'
import { formatCnpj } from '@/utils/sped'
import { podeAcessar } from '../config/modulos'
import { useUploadSped } from '../composables/useUploadSped'
import UiButton from '../components/ui/UiButton.vue'
import {
  Search, Building2, ChevronRight, Plus, Trash2, X, UploadCloud, Lock,
  BarChart2, ShieldCheck, FileText, HardDriveUpload, DatabaseZap, BookOpen,
} from 'lucide-vue-next'

const router = useRouter()
const route = useRoute()

// ----------------------------- Empresas -----------------------------
const empresas = ref([])
const loading = ref(true)
const busca = ref('')

const empresasFiltradas = computed(() => {
  if (!busca.value) return empresas.value
  const termo = busca.value.toLowerCase()
  return empresas.value.filter(e =>
    e.nome_empresa?.toLowerCase().includes(termo) ||
    e.nome_fantasia?.toLowerCase().includes(termo) ||
    e.cnpj?.includes(termo)
  )
})

async function carregarEmpresas() {
  loading.value = true
  const safety = setTimeout(() => { loading.value = false }, 15000)
  try {
    const res = await axios.get(`${API_BASE_URL}/api/empresas`)
    empresas.value = res.data
  } catch (error) {
    if (error.response?.status !== 401 && error.response?.status !== 403) {
      console.error('Falha ao buscar empresas:', error)
    }
  } finally {
    clearTimeout(safety)
    loading.value = false
  }
}

function selecionarEmpresa(empresa) {
  setEmpresaSelecionada(empresa)
  router.replace({ query: { empresa: empresa.id } })
}

// Confirmação ao ativar/trocar de cliente — evita selecionar a empresa errada por engano.
const showConfirmarEmpresaModal = ref(false)
const empresaParaConfirmar = ref(null)
function pedirConfirmacaoEmpresa(empresa) {
  if (empresaSelecionada.value?.id === empresa.id) return // já é a ativa, não precisa confirmar
  empresaParaConfirmar.value = empresa
  showConfirmarEmpresaModal.value = true
}
function confirmarEmpresaAtiva() {
  if (empresaParaConfirmar.value) selecionarEmpresa(empresaParaConfirmar.value)
  cancelarConfirmacaoEmpresa()
}
function cancelarConfirmacaoEmpresa() {
  showConfirmarEmpresaModal.value = false
  empresaParaConfirmar.value = null
}

onMounted(async () => {
  await carregarEmpresas()
  const q = route.query.empresa
  if (q) {
    const emp = empresas.value.find(e => String(e.id) === String(q))
    if (emp) setEmpresaSelecionada(emp)
  }
})

// ----------------------------- Upload -----------------------------
const {
  isUploading, uploadProgress, uploadMessage,
  showSequenciaModal, sequenciaInfo,
  selecionarArquivo, confirmarSequencia, cancelarSequencia,
} = useUploadSped()

const fileInput = ref(null)
const isDragging = ref(false)

function abrirSeletor() { if (!isUploading.value) fileInput.value?.click() }

function onFilePicked(e) {
  const file = e.target.files[0]
  if (file) selecionarArquivo(file, onArquivoEnviado)
  e.target.value = ''
}

function onDrop(e) {
  isDragging.value = false
  if (isUploading.value) return
  const file = e.dataTransfer.files[0]
  if (file) selecionarArquivo(file, onArquivoEnviado)
}

async function onArquivoEnviado({ id, fileInfo }) {
  if (fileInfo) {
    setArquivoInfo({ id, nome: fileInfo.nome_empresa, cnpj: fileInfo.cnpj_empresa, periodo: fileInfo.periodo_apuracao })
    setEmpresaSelecionada({ id: fileInfo.id_empresa, nome_empresa: fileInfo.nome_empresa, cnpj: fileInfo.cnpj_empresa, uf: fileInfo.uf })
  } else {
    setIdArquivoSped(id)
  }
  router.push(`/analisador/${id}`)
}

// ----------------------------- Módulos -----------------------------
// Ordem = fluxo de trabalho: abrir o SPED → conferir → validar → corrigir → gerar o livro.
const MODULOS = [
  { chave: 'gestao_speds', nome: 'Gestão de SPEDs', selo: 'Repositório', icon: DatabaseZap,
    desc: 'Abra o SPED do cliente para começar.',
    to: () => (empresaSelecionada.value ? `/empresa/${empresaSelecionada.value.id}` : null) },
  { chave: 'analisador', nome: 'Analisador', selo: 'Análise', icon: BarChart2,
    desc: 'Confere o arquivo e mostra onde tem erro.',
    to: () => '/analisador' },
  { chave: 'validador', nome: 'Validador SPED', selo: 'Validação', icon: ShieldCheck,
    desc: 'Valida pelas regras, como o PVA faria.',
    to: () => '/validador' },
  { chave: 'injetor_xml', nome: 'Injetor de XMLs', selo: 'Operacional', icon: HardDriveUpload,
    desc: 'Coloca no SPED a nota que faltou.',
    to: () => '/injetor-xml' },
  { chave: 'livro_lmc', nome: 'Livro LMC', selo: 'Obrigação', icon: FileText,
    desc: 'Monta o livro de combustível do posto.',
    requerSped: true, to: () => (arquivoInfo.value ? `/lmc/${arquivoInfo.value.id}` : null) },
]

const modulosView = computed(() => MODULOS.map(m => {
  const liberado = podeAcessar(m.chave, usuario.value)
  return {
    ...m,
    liberado,
    route: m.to(),
    requerSpedPendente: !!m.requerSped && liberado && !arquivoInfo.value,
  }
}))

function navegarModulo(m) {
  if (!m.liberado || m.requerSpedPendente || !m.route) return
  router.push(m.route)
}

// ----------------------------- Modais empresa -----------------------------
const isCreateModalOpen = ref(false)
const isDeleteModalOpen = ref(false)
const empresaToDelete = ref(null)
const deletando = ref(false)
const novaEmpresa = ref({ cnpj: '', nome_empresa: '', uf: '', nome_fantasia: '' })

const toast = ref({ show: false, message: '', type: 'success' })
function showToast(message, type = 'success') {
  toast.value = { show: true, message, type }
  setTimeout(() => { toast.value.show = false }, 4000)
}

function confirmDelete(empresa, event) {
  event.stopPropagation()
  empresaToDelete.value = empresa
  isDeleteModalOpen.value = true
}

async function deletarEmpresa() {
  if (!empresaToDelete.value || deletando.value) return
  const nome = empresaToDelete.value.nome_empresa
  const id = empresaToDelete.value.id
  deletando.value = true
  try {
    await axios.delete(`${API_BASE_URL}/api/empresas/${id}?cascade=true`)
    empresas.value = empresas.value.filter(e => e.id !== id)
    if (empresaSelecionada.value?.id === id) setEmpresaSelecionada(null)
    isDeleteModalOpen.value = false
    empresaToDelete.value = null
    showToast(`Empresa "${nome}" excluída com sucesso.`, 'success')
  } catch (error) {
    isDeleteModalOpen.value = false
    empresaToDelete.value = null
    showToast(error.response?.data?.message || 'Erro ao excluir a empresa. Tente novamente.', 'error')
  } finally {
    deletando.value = false
  }
}

async function criarEmpresa() {
  if (!novaEmpresa.value.cnpj || !novaEmpresa.value.nome_empresa) {
    alert('Preencha CNPJ e Nome da Empresa.')
    return
  }
  try {
    await axios.post(`${API_BASE_URL}/api/empresas`, {
      cnpj: novaEmpresa.value.cnpj.replace(/\D/g, ''),
      nome_empresa: novaEmpresa.value.nome_empresa,
      uf: novaEmpresa.value.uf.toUpperCase(),
      nome_fantasia: novaEmpresa.value.nome_fantasia,
    })
    await carregarEmpresas()
    novaEmpresa.value = { cnpj: '', nome_empresa: '', uf: '', nome_fantasia: '' }
    isCreateModalOpen.value = false
  } catch (error) {
    alert(error.response?.data?.message || 'Erro ao criar empresa.')
  }
}
</script>

<template>
  <div class="max-w-6xl mx-auto w-full py-8 px-4 sm:px-6 space-y-6 fade-in">

    <!-- Cabeçalho -->
    <header class="border-b border-line pb-5">
      <h1 class="font-display text-[26px] font-semibold tracking-[-0.01em] text-ink">Central de Operações</h1>
      <p class="text-[13px] text-risco mt-1">Escolha um cliente ou envie um SPED para começar a auditoria.</p>
    </header>

    <div class="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-5 items-start">

      <!-- ============ RAIL: lista de clientes ============ -->
      <section class="bg-sheet rounded-md border border-line card-shadow flex flex-col overflow-hidden">
        <div class="p-3 space-y-2">
          <div class="relative">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-risco pointer-events-none" :stroke-width="1.8" />
            <input
              v-model="busca"
              type="text"
              placeholder="Buscar razão social ou CNPJ…"
              class="block w-full pl-9 pr-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink placeholder-risco outline-none focus:border-bronze transition-colors"
            />
          </div>
          <UiButton variant="ghost" class="w-full justify-center" @click="isCreateModalOpen = true">
            <Building2 class="w-4 h-4 text-risco" :stroke-width="1.8" />
            Nova empresa
          </UiButton>
        </div>

        <div class="px-4 py-2 bg-paper border-y border-line text-[10px] font-semibold text-risco uppercase tracking-[.08em]">
          Clientes
        </div>

        <!-- loading -->
        <div v-if="loading" class="p-10 text-center space-y-3">
          <div class="inline-block w-6 h-6 border-2 border-line border-t-bronze rounded-full animate-spin"></div>
          <p class="text-risco text-[12px]">Buscando empresas…</p>
        </div>

        <!-- lista -->
        <div v-else-if="empresasFiltradas.length > 0" class="divide-y divide-line overflow-y-auto max-h-[52vh]">
          <div
            v-for="empresa in empresasFiltradas"
            :key="empresa.id"
            @click="pedirConfirmacaoEmpresa(empresa)"
            :class="[
              'group flex items-center gap-3 px-3.5 py-3 cursor-pointer border-l-2 transition-colors',
              empresaSelecionada?.id === empresa.id
                ? 'bg-paper border-l-bronze'
                : 'border-l-transparent hover:bg-paper'
            ]"
          >
            <div :class="[
              'w-9 h-9 rounded-md border bg-paper flex items-center justify-center flex-shrink-0 transition-all',
              empresaSelecionada?.id === empresa.id
                ? 'border-bronze/40 text-bronze'
                : 'border-line text-risco group-hover:border-bronze/40 group-hover:text-bronze'
            ]">
              <Building2 class="w-5 h-5" :stroke-width="1.6" />
            </div>
            <div class="min-w-0 flex-1">
              <h4 class="text-[13px] font-medium text-ink truncate">{{ empresa.nome_fantasia || empresa.nome_empresa }}</h4>
              <p class="text-[11px] font-mono text-risco truncate">{{ formatCnpj(empresa.cnpj) }}</p>
            </div>
            <span class="text-[10.5px] font-medium text-risco border border-line rounded px-1.5 py-0.5 bg-paper flex-shrink-0">
              {{ empresa.uf }}
            </span>
            <button
              @click.stop="confirmDelete(empresa, $event)"
              class="p-1 rounded-md text-risco opacity-0 group-hover:opacity-100 hover:text-lacre hover:bg-lacre/5 transition-all"
              title="Excluir empresa"
            >
              <Trash2 class="w-4 h-4" :stroke-width="1.6" />
            </button>
          </div>
        </div>

        <!-- vazio -->
        <div v-else class="p-10 text-center">
          <Building2 class="mx-auto h-9 w-9 text-line" :stroke-width="1.4" />
          <p class="mt-3 text-[12px] text-risco">
            {{ busca ? 'Nenhum cliente encontrado.' : 'Nenhum cliente ainda. Envie um SPED para cadastrar automaticamente.' }}
          </p>
          <button v-if="busca" @click="busca = ''" class="mt-3 text-[12px] text-bronze hover:opacity-80 font-medium">Limpar busca</button>
        </div>

        <!-- rodapé: catálogo (global) + contador -->
        <div class="mt-auto border-t border-line">
          <div
            @click="router.push('/catalogo-regras')"
            class="flex items-center gap-3 px-3.5 py-3 cursor-pointer hover:bg-paper transition-colors group"
          >
            <div class="w-8 h-8 rounded-md border border-line bg-paper flex items-center justify-center text-bronze flex-shrink-0">
              <BookOpen class="w-4 h-4" :stroke-width="1.7" />
            </div>
            <div class="min-w-0 flex-1">
              <b class="block text-[12.5px] font-medium text-ink">Catálogo de regras</b>
              <span class="text-[11px] text-risco">Regras ativas do validador</span>
            </div>
            <ChevronRight class="w-4 h-4 text-risco group-hover:translate-x-0.5 transition-transform" :stroke-width="1.8" />
          </div>
          <div v-if="!loading" class="px-3.5 py-2 border-t border-line text-[11.5px] text-risco">
            <b class="text-ink font-semibold">{{ empresas.length }}</b> clientes indexados a partir dos SPEDs.
          </div>
        </div>
      </section>

      <!-- ============ STAGE: upload + módulos ============ -->
      <section class="space-y-5 min-w-0">

        <!-- Dropzone (protagonista quando não há cliente; compacta quando há) -->
        <div
          @click="abrirSeletor"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @drop.prevent="onDrop"
          :class="[
            'bg-sheet border border-dashed rounded-md cursor-pointer transition-colors',
            isDragging ? 'border-bronze bg-bronze/[.03]' : 'border-line hover:border-bronze/55',
            empresaSelecionada ? 'p-6' : 'p-12 text-center'
          ]"
        >
          <input ref="fileInput" type="file" accept=".txt" class="hidden" @change="onFilePicked" />

          <!-- Enviando -->
          <div v-if="isUploading" class="space-y-3" :class="empresaSelecionada ? '' : 'max-w-md mx-auto'">
            <div class="flex items-center gap-3">
              <div class="w-6 h-6 border-2 border-line border-t-bronze rounded-full animate-spin flex-shrink-0"></div>
              <p class="text-[13px] text-ink font-medium">{{ uploadMessage }}</p>
            </div>
            <div class="h-1.5 bg-paper rounded-full overflow-hidden border border-line">
              <div class="h-full bg-bronze transition-all" :style="{ width: uploadProgress + '%' }"></div>
            </div>
          </div>

          <!-- Compacto (cliente selecionado) -->
          <div v-else-if="empresaSelecionada" class="flex items-center gap-5">
            <div class="w-13 h-13 p-3 rounded-md bg-paper border border-line text-bronze flex-shrink-0">
              <UploadCloud class="w-7 h-7" :stroke-width="1.6" />
            </div>
            <div>
              <h3 class="font-display text-[16px] font-semibold text-ink">Enviar arquivo SPED</h3>
              <p class="text-[12.5px] text-risco mt-0.5 leading-relaxed">
                Arraste o <span class="font-mono text-[11px] text-ink bg-paper border border-line rounded px-1.5 py-0.5">.txt</span>
                aqui ou clique para selecionar. O cliente é identificado pelo arquivo e a análise começa em seguida.
              </p>
            </div>
          </div>

          <!-- Hero (sem cliente) -->
          <div v-else>
            <div class="w-16 h-16 mx-auto mb-4 p-4 rounded-md bg-paper border border-line text-bronze">
              <UploadCloud class="w-8 h-8" :stroke-width="1.6" />
            </div>
            <h3 class="font-display text-[19px] font-semibold text-ink">Comece por um arquivo SPED</h3>
            <p class="text-[13px] text-risco mt-1.5 max-w-md mx-auto leading-relaxed">
              Arraste o <span class="font-mono text-[12px] text-ink bg-paper border border-line rounded px-1.5 py-0.5">.txt</span>
              aqui ou clique para selecionar. O cliente é cadastrado automaticamente. Já tem clientes? Escolha um na lista ao lado.
            </p>
          </div>
        </div>

        <!-- Cabeçalho do cliente + módulos (só com cliente selecionado) -->
        <template v-if="empresaSelecionada">
          <div class="flex items-center gap-3 pt-1">
            <div class="w-10 h-10 rounded-md border border-line bg-sheet flex items-center justify-center text-bronze flex-shrink-0">
              <Building2 class="w-5 h-5" :stroke-width="1.6" />
            </div>
            <div class="min-w-0">
              <h2 class="font-display text-[18px] font-semibold text-ink tracking-[-0.01em] truncate">
                {{ empresaSelecionada.nome_fantasia || empresaSelecionada.nome_empresa }}
              </h2>
              <div class="text-[12px] text-risco flex items-center gap-2 flex-wrap">
                <span class="font-mono text-ink">{{ formatCnpj(empresaSelecionada.cnpj) }}</span>
                <span v-if="empresaSelecionada.uf">·</span>
                <span v-if="empresaSelecionada.uf">{{ empresaSelecionada.uf }}</span>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            <button
              v-for="m in modulosView"
              :key="m.chave"
              type="button"
              @click="navegarModulo(m)"
              :title="m.nome + ' — ' + m.desc"
              :disabled="!m.liberado || m.requerSpedPendente"
              :class="[
                'group text-left flex items-center gap-3 p-3 rounded-md border transition-all duration-200',
                m.liberado
                  ? 'bg-sheet border-line hover:border-bronze/40 hover:shadow-[0_1px_4px_0_rgba(18,24,32,0.07)] cursor-pointer'
                  : 'bg-paper border-line opacity-60 cursor-not-allowed'
              ]"
            >
              <div :class="[
                'p-2 rounded-md border flex-shrink-0 transition-colors',
                m.liberado
                  ? 'bg-paper border-line text-risco group-hover:text-bronze group-hover:border-bronze/30'
                  : 'bg-sheet border-line text-risco'
              ]">
                <component :is="m.icon" class="w-[18px] h-[18px]" :stroke-width="1.7" />
              </div>

              <div class="min-w-0 flex-1">
                <h3 class="font-display text-[13.5px] font-semibold text-ink truncate">{{ m.nome }}</h3>
                <p class="text-[11.5px] text-risco truncate">{{ m.desc }}</p>
              </div>

              <!-- estado à direita: cadeado (bloqueado) · ponto âmbar (requer SPED) · seta (hover) -->
              <Lock v-if="!m.liberado" class="w-4 h-4 text-risco flex-shrink-0" :stroke-width="1.8" title="Não incluído no seu plano" />
              <span v-else-if="m.requerSpedPendente" class="w-2 h-2 rounded-full bg-variacao flex-shrink-0" title="Requer SPED carregado"></span>
              <ChevronRight v-else class="w-4 h-4 text-risco opacity-0 group-hover:opacity-100 group-hover:text-bronze transition-all flex-shrink-0" :stroke-width="1.8" />
            </button>
          </div>
        </template>
      </section>
    </div>

    <!-- ===================== MODAL NOVA EMPRESA ===================== -->
    <div v-if="isCreateModalOpen" class="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true">
      <div class="flex items-end sm:items-center justify-center min-h-screen p-4">
        <div class="fixed inset-0 bg-ink/40" @click="isCreateModalOpen = false"></div>
        <div class="relative bg-sheet rounded-md border border-line w-full sm:max-w-lg card-shadow">
          <div class="px-6 pt-5 pb-4">
            <div class="flex justify-between items-center border-b border-line pb-3 mb-4">
              <h3 class="font-display text-[16px] font-semibold text-ink">Cadastrar nova empresa</h3>
              <button @click="isCreateModalOpen = false" class="text-risco hover:text-ink transition-colors"><X class="w-5 h-5" /></button>
            </div>
            <div class="space-y-3.5">
              <div class="space-y-1">
                <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">CNPJ (apenas números)*</label>
                <input type="text" v-model="novaEmpresa.cnpj" class="w-full px-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink font-mono outline-none focus:border-bronze transition-colors" />
              </div>
              <div class="space-y-1">
                <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Razão social*</label>
                <input type="text" v-model="novaEmpresa.nome_empresa" class="w-full px-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink outline-none focus:border-bronze transition-colors" />
              </div>
              <div class="space-y-1">
                <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Nome fantasia</label>
                <input type="text" v-model="novaEmpresa.nome_fantasia" class="w-full px-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink outline-none focus:border-bronze transition-colors" />
              </div>
              <div class="space-y-1">
                <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">UF</label>
                <input type="text" v-model="novaEmpresa.uf" maxlength="2" placeholder="Ex: SP" class="w-20 px-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink uppercase outline-none focus:border-bronze transition-colors" />
              </div>
            </div>
          </div>
          <div class="bg-paper px-6 py-3 flex flex-row-reverse gap-2 border-t border-line rounded-b-md">
            <UiButton @click="criarEmpresa">Salvar empresa</UiButton>
            <UiButton variant="ghost" @click="isCreateModalOpen = false">Cancelar</UiButton>
          </div>
        </div>
      </div>
    </div>

    <!-- ===================== MODAL EXCLUIR ===================== -->
    <div v-if="isDeleteModalOpen" class="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true">
      <div class="flex items-end sm:items-center justify-center min-h-screen p-4">
        <div class="fixed inset-0 bg-ink/40" @click="isDeleteModalOpen = false"></div>
        <div class="relative bg-sheet rounded-md border border-line w-full sm:max-w-md card-shadow">
          <div class="px-6 pt-6 pb-4">
            <div class="flex items-start gap-4">
              <div class="flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-md bg-lacre/10">
                <Trash2 class="h-5 w-5 text-lacre" :stroke-width="1.6" />
              </div>
              <div>
                <h3 class="font-display text-[16px] font-semibold text-ink">Excluir cliente</h3>
                <p class="mt-2 text-[13px] text-risco leading-relaxed">
                  Tem certeza que deseja excluir a empresa <strong class="text-ink">{{ empresaToDelete?.nome_empresa }}</strong>?<br /><br />
                  <span class="text-lacre font-semibold">Esta ação é irreversível</span> e apagará permanentemente todos os arquivos SPED processados, XMLs e notas fiscais vinculadas a este cliente.
                </p>
              </div>
            </div>
          </div>
          <div class="bg-paper px-6 py-3 flex flex-row-reverse gap-2 border-t border-line rounded-b-md">
            <button
              @click="deletarEmpresa"
              :disabled="deletando"
              type="button"
              class="inline-flex items-center justify-center gap-2 rounded-md px-[13px] py-[7px] bg-lacre text-white text-[13px] font-medium hover:opacity-85 disabled:opacity-60 disabled:cursor-not-allowed transition-opacity"
            >
              <span v-if="deletando" class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
              {{ deletando ? 'Excluindo…' : 'Sim, excluir permanentemente' }}
            </button>
            <UiButton variant="ghost" @click="isDeleteModalOpen = false" :disabled="deletando">Cancelar</UiButton>
          </div>
        </div>
      </div>
    </div>

    <!-- ===================== MODAL CONFIRMAR CLIENTE ATIVO ===================== -->
    <div v-if="showConfirmarEmpresaModal" class="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true">
      <div class="flex items-end sm:items-center justify-center min-h-screen p-4">
        <div class="fixed inset-0 bg-ink/40" @click="cancelarConfirmacaoEmpresa"></div>
        <div class="relative bg-sheet rounded-md border border-line w-full sm:max-w-md card-shadow">
          <div class="px-6 pt-6 pb-4">
            <div class="flex items-start gap-4">
              <div class="flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-md bg-bronze/10">
                <Building2 class="h-5 w-5 text-bronze" :stroke-width="1.6" />
              </div>
              <div class="min-w-0">
                <h3 class="font-display text-[16px] font-semibold text-ink">Confirmar cliente ativo</h3>
                <p class="mt-2 text-[13px] text-risco leading-relaxed">
                  Você vai trabalhar com
                  <strong class="text-ink">{{ empresaParaConfirmar?.nome_fantasia || empresaParaConfirmar?.nome_empresa }}</strong>.
                  <span class="block font-mono text-[12px] text-risco mt-1">{{ formatCnpj(empresaParaConfirmar?.cnpj) }}</span>
                  <span v-if="empresaSelecionada" class="block mt-2">Isso troca o cliente ativo (atual: <strong class="text-ink">{{ empresaSelecionada.nome_fantasia || empresaSelecionada.nome_empresa }}</strong>).</span>
                </p>
              </div>
            </div>
          </div>
          <div class="bg-paper px-6 py-3 flex flex-row-reverse gap-2 border-t border-line rounded-b-md">
            <UiButton @click="confirmarEmpresaAtiva">Sim, trabalhar com este cliente</UiButton>
            <UiButton variant="ghost" @click="cancelarConfirmacaoEmpresa">Cancelar</UiButton>
          </div>
        </div>
      </div>
    </div>

    <!-- ===================== MODAL SEQUÊNCIA DE PERÍODO ===================== -->
    <div v-if="showSequenciaModal" class="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true">
      <div class="flex items-end sm:items-center justify-center min-h-screen p-4">
        <div class="fixed inset-0 bg-ink/40" @click="cancelarSequencia"></div>
        <div class="relative bg-sheet rounded-md border border-line w-full sm:max-w-md card-shadow">
          <div class="px-6 pt-6 pb-4">
            <h3 class="font-display text-[16px] font-semibold text-ink">Período fora de sequência</h3>
            <p class="mt-2 text-[13px] text-risco leading-relaxed" v-if="sequenciaInfo">
              O último período de <strong class="text-ink">{{ sequenciaInfo.empresa }}</strong> é
              <strong class="text-ink">{{ sequenciaInfo.ultimoPeriodo }}</strong>. O esperado seria
              <strong class="text-ink">{{ sequenciaInfo.esperado }}</strong>, mas o arquivo é de
              <strong class="text-ink">{{ sequenciaInfo.novoPeriodo }}</strong>.<br /><br />
              Carregar fora de ordem pode gerar inconsistências na continuidade do LMC. Deseja continuar?
            </p>
          </div>
          <div class="bg-paper px-6 py-3 flex flex-row-reverse gap-2 border-t border-line rounded-b-md">
            <UiButton @click="confirmarSequencia">Continuar mesmo assim</UiButton>
            <UiButton variant="ghost" @click="cancelarSequencia">Cancelar</UiButton>
          </div>
        </div>
      </div>
    </div>

    <!-- ===================== TOAST ===================== -->
    <transition name="toast">
      <div
        v-if="toast.show"
        :class="[
          'fixed bottom-6 right-6 z-[9999] flex items-center gap-3 px-4 py-3 rounded-md text-[13px] font-medium text-white card-shadow',
          toast.type === 'success' ? 'bg-conforme' : 'bg-lacre'
        ]"
      >
        {{ toast.message }}
        <button @click="toast.show = false" class="ml-2 text-white/70 hover:text-white font-bold">×</button>
      </div>
    </transition>

  </div>
</template>

<style scoped>
.card-shadow { box-shadow: 0 1px 4px 0 rgba(18, 24, 32, 0.07); }
.w-13 { width: 3.25rem; }
.h-13 { height: 3.25rem; }
.fade-in { animation: fadeIn 0.3s ease-out; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
.toast-enter-active, .toast-leave-active { transition: all 0.35s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(20px); }
</style>
