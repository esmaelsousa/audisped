<script setup>
import { ref, onMounted } from 'vue';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import { token, empresaSelecionada } from '../store';
import {
  UploadCloud, X, Download, CheckCircle2, AlertTriangle,
  Terminal, Play, Eye, Truck, FileText, ArrowLeft
} from 'lucide-vue-next';
import { useRouter } from 'vue-router';
import UiButton from '@/components/ui/UiButton.vue';

const router = useRouter();

// Estado
const xmlFiles   = ref([]);
const isLoading  = ref(false);
const logs       = ref([]);
const ctes       = ref([]);
const relatorio  = ref(null);
const spedFiles  = ref([]);
const idSpedBase = ref('');
const pularDuplicados = ref(true);
const fase = ref('idle'); // idle | analisado | injetado

// ── Carregar arquivos SPED da empresa ─────────────────────────────────────────
onMounted(loadSpedFiles);

async function loadSpedFiles() {
    if (!empresaSelecionada.value) return;
    try {
        const res = await axios.get(`${API_BASE_URL}/api/arquivos/empresa/${empresaSelecionada.value.id}`, {
            headers: { Authorization: `Bearer ${token.value}` }
        });
        spedFiles.value = res.data || [];
    } catch (_) {
        spedFiles.value = [];
    }
}

// ── Upload de XMLs ─────────────────────────────────────────────────────────────
function handleFiles(e) {
    const novos = Array.from(e.target?.files || e.dataTransfer?.files || [])
        .filter(f => f.name.toLowerCase().endsWith('.xml'));
    xmlFiles.value = [...xmlFiles.value, ...novos];
    if (e.target) e.target.value = '';
}

function remover(i) { xmlFiles.value.splice(i, 1); }

function onDrop(e) {
    e.preventDefault();
    handleFiles(e);
}

// ── Analisar ──────────────────────────────────────────────────────────────────
async function analisar() {
    if (!xmlFiles.value.length) return;
    isLoading.value = true;
    logs.value = ['Analisando CT-es...'];
    fase.value = 'idle';
    try {
        const fd = new FormData();
        xmlFiles.value.forEach(f => fd.append('xmlFiles', f));
        const res = await axios.post(`${API_BASE_URL}/api/cte-injector/analyze`, fd, {
            headers: { 'Content-Type': 'multipart/form-data', Authorization: `Bearer ${token.value}` }
        });
        ctes.value = res.data.ctes;
        relatorio.value = res.data.relatorio;
        logs.value = [
            `[OK] ${res.data.relatorio.totalCtes} CT-e(s) válido(s)`,
            `[INFO] ${res.data.relatorio.totalPulados} duplicado(s) ignorado(s)`,
            `[INFO] Frete total: R$ ${res.data.relatorio.totalFrete}`,
            ...(res.data.erros?.length ? res.data.erros.map(e => `[ERRO] ${e}`) : []),
        ];
        fase.value = 'analisado';
    } catch (err) {
        logs.value = [`[ERRO] ${err.response?.data?.message || err.message}`];
    } finally {
        isLoading.value = false;
    }
}

// ── Modal período divergente ──────────────────────────────────────────────────
const modalPeriodo = ref(false);
const modalPeriodoData = ref({ periodo_sped: '', avisos: [] });
let _pendingFdCte = null;

async function confirmarForcePeriodo() {
    modalPeriodo.value = false;
    if (!_pendingFdCte) return;
    _pendingFdCte.set('force_periodo', 'true');
    await _executarInjecao(_pendingFdCte);
    _pendingFdCte = null;
}

async function _executarInjecao(fd) {
    isLoading.value = true;
    try {
        const res = await axios.post(`${API_BASE_URL}/api/cte-injector/inject`, fd, {
            headers: { 'Content-Type': 'multipart/form-data', Authorization: `Bearer ${token.value}` },
            responseType: 'blob',
        });
        const disposition = res.headers['content-disposition'] || '';
        const match = disposition.match(/filename=([^;]+)/);
        const nomeArquivo = match ? match[1].trim() : `sped_cte_${idSpedBase.value}.txt`;
        const url = URL.createObjectURL(new Blob([res.data], { type: 'text/plain' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = nomeArquivo;
        a.click();
        URL.revokeObjectURL(url);
        logs.value = ['[OK] CT-es injetados com sucesso! Download iniciado.'];
        fase.value = 'injetado';
    } catch (err) {
        const data = err.response?.data;
        // Tenta ler JSON mesmo quando responseType é blob
        let jsonData = data;
        if (data instanceof Blob) {
            try { jsonData = JSON.parse(await data.text()); } catch (_) { jsonData = null; }
        }
        if (jsonData?.tipo === 'cnpj_invalido') {
            logs.value = [`[BLOQUEADO] ${jsonData.message}`];
            jsonData.bloqueados.forEach(b => logs.value.push(`  ✗ ${b.arquivo} → CT-e é de ${b.nome_xml || '(nome indisponível)'} (CNPJ ${b.cnpj_xml}) | SPED selecionado: CNPJ ${b.cnpj_sped}`));
        } else if (jsonData?.tipo === 'periodo_divergente') {
            _pendingFdCte = fd;
            modalPeriodoData.value = { periodo_sped: jsonData.periodo_sped, avisos: jsonData.avisos };
            modalPeriodo.value = true;
        } else {
            const msg = jsonData?.message || err.message;
            logs.value = [`[ERRO] ${msg}`];
        }
    } finally {
        isLoading.value = false;
    }
}

// ── Injetar ───────────────────────────────────────────────────────────────────
async function injetar() {
    if (!xmlFiles.value.length) return alert('Carregue os XMLs primeiro.');
    if (!idSpedBase.value) return alert('Selecione um arquivo SPED base.');
    logs.value = ['Injetando CT-es no SPED...'];
    const fd = new FormData();
    xmlFiles.value.forEach(f => fd.append('xmlFiles', f));
    fd.append('id_arquivo', idSpedBase.value);
    fd.append('pularDuplicados', pularDuplicados.value ? '1' : '0');
    await _executarInjecao(fd);
}
</script>

<template>
  <div class="max-w-6xl mx-auto py-8 px-4 sm:px-6 text-ink">

    <!-- Cabeçalho -->
    <div class="flex items-center gap-3 mb-6 border-b border-line pb-5">
      <button @click="router.back()" class="p-2 rounded-md hover:bg-paper transition-colors text-risco">
        <ArrowLeft class="w-5 h-5" :stroke-width="1.8" />
      </button>
      <Truck class="w-6 h-6 text-bronze" :stroke-width="1.6" />
      <div>
        <h1 class="font-display text-[22px] font-semibold tracking-[-0.01em] text-ink">Injetor CT-e</h1>
        <p class="text-[13px] text-risco">Injeta Conhecimentos de Transporte no Bloco D do SPED Fiscal</p>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">

      <!-- Coluna esquerda: configurações -->
      <div class="lg:col-span-1 space-y-4">

        <!-- Upload XMLs -->
        <div class="bg-sheet rounded-md border border-line p-4 card-shadow">
          <h2 class="text-[11px] uppercase tracking-wide font-medium text-risco mb-3 flex items-center gap-2">
            <UploadCloud class="w-4 h-4 text-bronze" :stroke-width="1.8" /> XMLs de CT-e
          </h2>
          <div
            class="border-2 border-dashed border-line rounded-md p-5 text-center cursor-pointer hover:border-bronze transition-colors"
            @dragover.prevent @drop="onDrop"
            @click="$refs.fileInput.click()"
          >
            <UploadCloud class="w-8 h-8 mx-auto mb-2 text-risco" :stroke-width="1.6" />
            <p class="text-[12px] text-risco">Arraste XMLs aqui ou clique para selecionar</p>
            <input ref="fileInput" type="file" multiple accept=".xml" class="hidden" @change="handleFiles" />
          </div>

          <!-- Lista de arquivos -->
          <div v-if="xmlFiles.length" class="mt-3 space-y-1 max-h-48 overflow-y-auto">
            <div v-for="(f, i) in xmlFiles" :key="i"
              class="flex items-center justify-between bg-paper border border-line rounded px-2 py-1 text-[12px]">
              <span class="truncate text-ink flex items-center gap-1">
                <FileText class="w-3 h-3 text-bronze flex-shrink-0" :stroke-width="1.8" />
                {{ f.name }}
              </span>
              <button @click="remover(i)" class="ml-2 text-risco hover:text-lacre flex-shrink-0">
                <X class="w-3 h-3" />
              </button>
            </div>
          </div>
          <p v-if="xmlFiles.length" class="text-[11px] text-risco mt-2">{{ xmlFiles.length }} arquivo(s) selecionado(s)</p>
        </div>

        <!-- SPED Base -->
        <div class="bg-sheet rounded-md border border-line p-4 card-shadow">
          <h2 class="text-[11px] uppercase tracking-wide font-medium text-risco mb-3">SPED Base</h2>
          <select v-model="idSpedBase"
            class="w-full bg-sheet border border-line rounded-md px-3 py-2 text-[13px] text-ink outline-none focus:border-bronze transition-colors">
            <option value="">— selecione o arquivo SPED —</option>
            <option v-for="a in spedFiles" :key="a.id" :value="a.id">
              {{ a.periodo_apuracao || a.nome_arquivo || `#${a.id}` }}
            </option>
          </select>
        </div>

        <!-- Opções -->
        <div class="bg-sheet rounded-md border border-line p-4 card-shadow">
          <h2 class="text-[11px] uppercase tracking-wide font-medium text-risco mb-3">Opções</h2>
          <label class="flex items-center gap-2 text-[13px] text-ink cursor-pointer">
            <input type="checkbox" v-model="pularDuplicados" class="accent-bronze w-4 h-4" />
            Pular CT-es duplicados
          </label>
        </div>

        <!-- Botões -->
        <div class="space-y-2">
          <UiButton variant="ghost" @click="analisar" :disabled="!xmlFiles.length || isLoading"
            class="w-full justify-center py-[9px] disabled:opacity-50 disabled:cursor-not-allowed">
            <Eye class="w-4 h-4" :stroke-width="1.8" />
            {{ isLoading && fase === 'idle' ? 'Analisando...' : 'Analisar CT-es' }}
          </UiButton>

          <UiButton @click="injetar" :disabled="!xmlFiles.length || !idSpedBase || isLoading"
            class="w-full justify-center py-[9px] disabled:opacity-50 disabled:cursor-not-allowed">
            <Download class="w-4 h-4" :stroke-width="1.8" />
            {{ isLoading && fase !== 'idle' ? 'Injetando...' : 'Injetar e Baixar SPED' }}
          </UiButton>
        </div>
      </div>

      <!-- Coluna direita: resultado -->
      <div class="lg:col-span-2 space-y-4">

        <!-- Log -->
        <div class="bg-sheet rounded-md border border-line p-4 card-shadow">
          <h2 class="text-[11px] uppercase tracking-wide font-medium text-risco mb-2 flex items-center gap-2">
            <Terminal class="w-4 h-4 text-conforme" :stroke-width="1.8" /> Log
          </h2>
          <div class="bg-graphite rounded-md p-3 font-mono text-[12px] min-h-[60px] max-h-40 overflow-y-auto space-y-0.5">
            <p v-if="!logs.length" class="text-muted">Aguardando...</p>
            <p v-for="(l, i) in logs" :key="i"
              :class="l.startsWith('[ERRO]') ? 'text-lacre' : l.startsWith('[OK]') ? 'text-conforme' : 'text-line'">
              {{ l }}
            </p>
          </div>
        </div>

        <!-- Relatório resumido -->
        <div v-if="relatorio" class="grid grid-cols-3 gap-3">
          <div class="bg-sheet rounded-md border border-line p-3 text-center card-shadow">
            <p class="text-[26px] font-display font-semibold text-bronze">{{ relatorio.totalCtes }}</p>
            <p class="text-[11px] text-risco mt-1">CT-es válidos</p>
          </div>
          <div class="bg-sheet rounded-md border border-line p-3 text-center card-shadow">
            <p class="text-[26px] font-display font-semibold text-variacao">{{ relatorio.totalPulados }}</p>
            <p class="text-[11px] text-risco mt-1">Duplicados</p>
          </div>
          <div class="bg-sheet rounded-md border border-line p-3 text-center card-shadow">
            <p class="text-[26px] font-display font-semibold text-conforme">{{ relatorio.totalFrete }}</p>
            <p class="text-[11px] text-risco mt-1">Frete total (R$)</p>
          </div>
        </div>

        <!-- Tabela CT-es -->
        <div v-if="ctes.length" class="bg-sheet rounded-md border border-line p-4 card-shadow">
          <h2 class="text-[11px] uppercase tracking-wide font-medium text-risco mb-3 flex items-center gap-2">
            <Truck class="w-4 h-4 text-bronze" :stroke-width="1.8" /> CT-es encontrados ({{ ctes.length }})
          </h2>
          <div class="overflow-x-auto">
            <table class="w-full text-[12px]">
              <thead>
                <tr class="bg-paper text-risco uppercase text-[10px] tracking-wide">
                  <th class="text-left py-1.5 px-3 font-medium">Número</th>
                  <th class="text-left py-1.5 px-3 font-medium">Emitente</th>
                  <th class="text-left py-1.5 px-3 font-medium">Data</th>
                  <th class="text-left py-1.5 px-3 font-medium">CFOP</th>
                  <th class="text-right py-1.5 px-3 font-medium">Frete</th>
                  <th class="text-right py-1.5 px-3 font-medium">ICMS</th>
                  <th class="text-right py-1.5 px-3 font-medium">CST</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(c, i) in ctes" :key="i"
                  class="border-t border-line hover:bg-paper transition-colors">
                  <td class="py-1.5 px-3 text-ink font-mono">{{ parseInt(c.numero) }}</td>
                  <td class="py-1.5 px-3 text-ink truncate max-w-[180px]" :title="c.emitente">{{ c.emitente }}</td>
                  <td class="py-1.5 px-3 text-risco font-mono">{{ c.dt_doc }}</td>
                  <td class="py-1.5 px-3 text-bronze font-mono">{{ c.cfop }}</td>
                  <td class="py-1.5 px-3 text-right text-ink font-mono">{{ Number(c.vl_doc).toFixed(2) }}</td>
                  <td class="py-1.5 px-3 text-right text-ink font-mono">{{ Number(c.vl_icms).toFixed(2) }}</td>
                  <td class="py-1.5 px-3 text-right text-risco font-mono">{{ c.cst_icms }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Estado vazio -->
        <div v-else-if="!isLoading && fase === 'idle'"
          class="bg-sheet rounded-md border border-line p-12 text-center card-shadow">
          <Truck class="w-12 h-12 mx-auto mb-4 text-line" :stroke-width="1.4" />
          <p class="text-[13px] text-risco">Selecione os XMLs de CT-e e clique em <strong class="text-ink">Analisar</strong></p>
        </div>

        <!-- Sucesso injeção -->
        <div v-if="fase === 'injetado'"
          class="bg-conforme/[0.06] border border-conforme/25 rounded-md p-4 flex items-center gap-3">
          <CheckCircle2 class="w-5 h-5 text-conforme flex-shrink-0" :stroke-width="1.8" />
          <p class="text-[13px] text-conforme">SPED gerado e download iniciado. Verifique o Bloco D no arquivo baixado.</p>
        </div>

      </div>
    </div>

    <!-- Modal: Período Divergente -->
    <Teleport to="body">
      <div v-if="modalPeriodo" class="fixed inset-0 z-50 flex items-center justify-center bg-ink/40">
        <div class="bg-sheet rounded-md border border-line w-full max-w-lg mx-4 overflow-hidden card-shadow">
          <div class="bg-variacao/10 border-b border-variacao/25 px-6 py-4 flex items-center gap-3">
            <AlertTriangle class="w-5 h-5 text-variacao shrink-0" :stroke-width="1.8" />
            <h2 class="font-display text-[15px] font-semibold text-ink">Atenção — Período Divergente</h2>
          </div>
          <div class="px-6 py-4 space-y-3">
            <p class="text-[13px] text-risco">Os CT-es abaixo possuem data fora do período auditado. Deseja injetá-los mesmo assim?</p>
            <div class="bg-paper border border-line rounded-md px-4 py-2 text-[12px] font-mono text-ink">
              Período do SPED: {{ modalPeriodoData.periodo_sped }}
            </div>
            <ul class="space-y-1 max-h-48 overflow-y-auto">
              <li v-for="a in modalPeriodoData.avisos" :key="a.arquivo" class="flex items-center justify-between bg-paper border border-line rounded px-3 py-1.5 text-[12px]">
                <span class="text-ink truncate max-w-[260px]">{{ a.arquivo }}</span>
                <span class="text-variacao font-mono shrink-0 ml-2">{{ a.data_xml }}</span>
              </li>
            </ul>
          </div>
          <div class="bg-paper px-6 py-4 flex justify-end gap-3 border-t border-line">
            <UiButton variant="ghost" @click="modalPeriodo = false; logs.push('[CANCELADO] Injeção cancelada pelo usuário.')">
              Cancelar
            </UiButton>
            <UiButton @click="confirmarForcePeriodo">
              Confirmar Injeção
            </UiButton>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.card-shadow {
  box-shadow: 0 1px 4px 0 rgba(18, 24, 32, 0.07);
}
</style>
