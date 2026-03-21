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

// ── Injetar ───────────────────────────────────────────────────────────────────
async function injetar() {
    if (!xmlFiles.value.length) return alert('Carregue os XMLs primeiro.');
    if (!idSpedBase.value) return alert('Selecione um arquivo SPED base.');
    isLoading.value = true;
    logs.value = ['Injetando CT-es no SPED...'];
    try {
        const fd = new FormData();
        xmlFiles.value.forEach(f => fd.append('xmlFiles', f));
        fd.append('id_arquivo', idSpedBase.value);
        fd.append('pularDuplicados', pularDuplicados.value ? '1' : '0');

        const res = await axios.post(`${API_BASE_URL}/api/cte-injector/inject`, fd, {
            headers: { 'Content-Type': 'multipart/form-data', Authorization: `Bearer ${token.value}` },
            responseType: 'blob',
        });

        // Download automático — usa o nome definido pelo servidor
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
        const msg = err.response?.data instanceof Blob
            ? await err.response.data.text()
            : (err.response?.data?.message || err.message);
        logs.value = [`[ERRO] ${msg}`];
    } finally {
        isLoading.value = false;
    }
}
</script>

<template>
  <div class="min-h-screen bg-gray-950 text-gray-100 p-6">

    <!-- Cabeçalho -->
    <div class="flex items-center gap-3 mb-6">
      <button @click="router.back()" class="p-2 rounded-lg hover:bg-gray-800 transition-colors">
        <ArrowLeft class="w-5 h-5 text-gray-400" />
      </button>
      <Truck class="w-7 h-7 text-blue-400" />
      <div>
        <h1 class="text-2xl font-bold text-white">Injetor CT-e</h1>
        <p class="text-sm text-gray-400">Injeta Conhecimentos de Transporte no Bloco D do SPED Fiscal</p>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">

      <!-- Coluna esquerda: configurações -->
      <div class="lg:col-span-1 space-y-4">

        <!-- Upload XMLs -->
        <div class="bg-gray-900 rounded-xl border border-gray-700 p-4">
          <h2 class="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <UploadCloud class="w-4 h-4 text-blue-400" /> XMLs de CT-e
          </h2>
          <div
            class="border-2 border-dashed border-gray-600 rounded-lg p-5 text-center cursor-pointer hover:border-blue-500 transition-colors"
            @dragover.prevent @drop="onDrop"
            @click="$refs.fileInput.click()"
          >
            <UploadCloud class="w-8 h-8 mx-auto mb-2 text-gray-500" />
            <p class="text-xs text-gray-400">Arraste XMLs aqui ou clique para selecionar</p>
            <input ref="fileInput" type="file" multiple accept=".xml" class="hidden" @change="handleFiles" />
          </div>

          <!-- Lista de arquivos -->
          <div v-if="xmlFiles.length" class="mt-3 space-y-1 max-h-48 overflow-y-auto">
            <div v-for="(f, i) in xmlFiles" :key="i"
              class="flex items-center justify-between bg-gray-800 rounded px-2 py-1 text-xs">
              <span class="truncate text-gray-300 flex items-center gap-1">
                <FileText class="w-3 h-3 text-blue-400 flex-shrink-0" />
                {{ f.name }}
              </span>
              <button @click="remover(i)" class="ml-2 text-gray-500 hover:text-red-400 flex-shrink-0">
                <X class="w-3 h-3" />
              </button>
            </div>
          </div>
          <p v-if="xmlFiles.length" class="text-xs text-gray-500 mt-2">{{ xmlFiles.length }} arquivo(s) selecionado(s)</p>
        </div>

        <!-- SPED Base -->
        <div class="bg-gray-900 rounded-xl border border-gray-700 p-4">
          <h2 class="text-sm font-semibold text-gray-300 mb-3">SPED Base</h2>
          <select v-model="idSpedBase"
            class="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500">
            <option value="">— selecione o arquivo SPED —</option>
            <option v-for="a in spedFiles" :key="a.id" :value="a.id">
              {{ a.periodo_apuracao || a.nome_arquivo || `#${a.id}` }}
            </option>
          </select>
        </div>

        <!-- Opções -->
        <div class="bg-gray-900 rounded-xl border border-gray-700 p-4">
          <h2 class="text-sm font-semibold text-gray-300 mb-3">Opções</h2>
          <label class="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
            <input type="checkbox" v-model="pularDuplicados" class="accent-blue-500 w-4 h-4" />
            Pular CT-es duplicados
          </label>
        </div>

        <!-- Botões -->
        <div class="space-y-2">
          <button @click="analisar" :disabled="!xmlFiles.length || isLoading"
            class="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-medium text-sm transition-colors
                   bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed">
            <Eye class="w-4 h-4" />
            {{ isLoading && fase === 'idle' ? 'Analisando...' : 'Analisar CT-es' }}
          </button>

          <button @click="injetar" :disabled="!xmlFiles.length || !idSpedBase || isLoading"
            class="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-semibold text-sm transition-colors
                   bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed">
            <Download class="w-4 h-4" />
            {{ isLoading && fase !== 'idle' ? 'Injetando...' : 'Injetar e Baixar SPED' }}
          </button>
        </div>
      </div>

      <!-- Coluna direita: resultado -->
      <div class="lg:col-span-2 space-y-4">

        <!-- Log -->
        <div class="bg-gray-900 rounded-xl border border-gray-700 p-4">
          <h2 class="text-sm font-semibold text-gray-300 mb-2 flex items-center gap-2">
            <Terminal class="w-4 h-4 text-green-400" /> Log
          </h2>
          <div class="bg-gray-950 rounded-lg p-3 font-mono text-xs min-h-[60px] max-h-40 overflow-y-auto space-y-0.5">
            <p v-if="!logs.length" class="text-gray-600">Aguardando...</p>
            <p v-for="(l, i) in logs" :key="i"
              :class="l.startsWith('[ERRO]') ? 'text-red-400' : l.startsWith('[OK]') ? 'text-green-400' : 'text-gray-400'">
              {{ l }}
            </p>
          </div>
        </div>

        <!-- Relatório resumido -->
        <div v-if="relatorio" class="grid grid-cols-3 gap-3">
          <div class="bg-gray-900 rounded-xl border border-gray-700 p-3 text-center">
            <p class="text-2xl font-bold text-blue-400">{{ relatorio.totalCtes }}</p>
            <p class="text-xs text-gray-400 mt-1">CT-es válidos</p>
          </div>
          <div class="bg-gray-900 rounded-xl border border-gray-700 p-3 text-center">
            <p class="text-2xl font-bold text-yellow-400">{{ relatorio.totalPulados }}</p>
            <p class="text-xs text-gray-400 mt-1">Duplicados</p>
          </div>
          <div class="bg-gray-900 rounded-xl border border-gray-700 p-3 text-center">
            <p class="text-2xl font-bold text-green-400">{{ relatorio.totalFrete }}</p>
            <p class="text-xs text-gray-400 mt-1">Frete total (R$)</p>
          </div>
        </div>

        <!-- Tabela CT-es -->
        <div v-if="ctes.length" class="bg-gray-900 rounded-xl border border-gray-700 p-4">
          <h2 class="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <Truck class="w-4 h-4 text-blue-400" /> CT-es encontrados ({{ ctes.length }})
          </h2>
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead>
                <tr class="text-gray-400 border-b border-gray-700">
                  <th class="text-left py-1.5 pr-3">Número</th>
                  <th class="text-left py-1.5 pr-3">Emitente</th>
                  <th class="text-left py-1.5 pr-3">Data</th>
                  <th class="text-left py-1.5 pr-3">CFOP</th>
                  <th class="text-right py-1.5 pr-3">Frete</th>
                  <th class="text-right py-1.5 pr-3">ICMS</th>
                  <th class="text-right py-1.5">CST</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(c, i) in ctes" :key="i"
                  class="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                  <td class="py-1.5 pr-3 text-white font-mono">{{ parseInt(c.numero) }}</td>
                  <td class="py-1.5 pr-3 text-gray-300 truncate max-w-[180px]" :title="c.emitente">{{ c.emitente }}</td>
                  <td class="py-1.5 pr-3 text-gray-400">{{ c.dt_doc }}</td>
                  <td class="py-1.5 pr-3 text-blue-400">{{ c.cfop }}</td>
                  <td class="py-1.5 pr-3 text-right text-green-400">{{ Number(c.vl_doc).toFixed(2) }}</td>
                  <td class="py-1.5 pr-3 text-right text-yellow-400">{{ Number(c.vl_icms).toFixed(2) }}</td>
                  <td class="py-1.5 text-right text-gray-400">{{ c.cst_icms }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Estado vazio -->
        <div v-else-if="!isLoading && fase === 'idle'"
          class="bg-gray-900 rounded-xl border border-gray-700 p-12 text-center">
          <Truck class="w-12 h-12 mx-auto mb-4 text-gray-700" />
          <p class="text-gray-500">Selecione os XMLs de CT-e e clique em <strong class="text-gray-400">Analisar</strong></p>
        </div>

        <!-- Sucesso injeção -->
        <div v-if="fase === 'injetado'"
          class="bg-green-900/30 border border-green-700 rounded-xl p-4 flex items-center gap-3">
          <CheckCircle2 class="w-5 h-5 text-green-400 flex-shrink-0" />
          <p class="text-sm text-green-300">SPED gerado e download iniciado. Verifique o Bloco D no arquivo baixado.</p>
        </div>

      </div>
    </div>
  </div>
</template>
