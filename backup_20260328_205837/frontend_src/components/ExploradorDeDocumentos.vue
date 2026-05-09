<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'
import { API_BASE_URL } from '../../api'

const status = ref('Aguardando carregamento de ficheiro SPED...')
const documentos = ref([])

async function carregarDocumentos(id) {
  if (!id) {
    status.value = "ID de ficheiro inválido.";
    return;
  }
  
  status.value = `A buscar documentos do ficheiro ID: ${id}...`;
  documentos.value = []; // Limpa a lista antiga

  try {
    const response = await axios.get(`${API_BASE_URL}/api/documentos/entradas/${id}`)
    
    documentos.value = response.data
    status.value = `Sucesso! ${response.data.length} documentos de entrada carregados.`

  } catch (error) {
    console.error('Erro ao buscar documentos:', error)
    status.value = 'Erro: Não foi possível conectar ou buscar dados no servidor backend.'
  }
}

// Expõe a função para que o componente pai (App.vue) possa chamá-la
defineExpose({
  carregarDocumentos
});
</script>

<template>
  <div>
    <h2>Explorador de Documentos</h2>
    <p class="status">{{ status }}</p>

    <div class="doc-list" v-if="documentos.length > 0">
      <h3>Documentos de Entrada (C100)</h3>
      <ul>
        <li v-for="doc in documentos" :key="doc.id">
          <span><strong>NF:</strong> {{ doc.num_doc }}</span>
          <span><strong>Fornecedor:</strong> {{ doc.nome_fornecedor || 'N/A' }}</span>
          <span><strong>Valor:</strong> R$ {{ doc.vl_doc }}</span>
        </li>
      </ul>
    </div>
    <p v-else>Nenhum documento para exibir.</p>
  </div>
</template>

<style scoped>
  h2 { color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px; }
  .status { background-color: #ecf0f1; padding: 0.5em 1em; border-radius: 5px; margin-bottom: 2em; display: inline-block; }
  .doc-list { margin-top: 2em; }
  ul { list-style-type: none; padding: 0; }
  li {
    background-color: white;
    padding: 1em;
    margin-bottom: 0.5em;
    border-radius: 5px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
</style>