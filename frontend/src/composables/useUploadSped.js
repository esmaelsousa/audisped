// Fluxo de upload de SPED reaproveitável (usado pelo Cockpit).
//
// Espelha a lógica original do AnalisadorView (verificação de sequência de período +
// POST /api/upload com tratamento de 409/sobrescrever/reparo físico). O AnalisadorView
// mantém sua própria cópia por ora — refatorá-lo (arquivo de 3400+ linhas, sem testes,
// com SSE e modais acoplados) seria a parte arriscada; a duplicação é uma dívida aceita
// e documentada no spec. A diferença aqui: no sucesso NÃO roda a análise; apenas entrega
// o resultado ao chamador, que navega para /analisador/:id — cujo onMounted já dispara a
// análise sozinho.

import { ref } from 'vue'
import axios from 'axios'
import { API_BASE_URL } from '../api'

// Lê a primeira linha (registro 0000) do .txt para extrair CNPJ e data inicial.
function parseSpedHeader(file) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target.result
      const firstLine = (text.split('\n')[0]) || ''
      const parts = firstLine.split('|')
      // |0000|...|DT_INI|DT_FIN|NOME|CNPJ|...
      if (parts[1] === '0000' && parts.length > 7) {
        const dtIni = parts[3] || '' // DDMMYYYY
        const cnpj = (parts[7] || '').replace(/\D/g, '')
        resolve({ dtIni, cnpj })
      } else {
        resolve(null)
      }
    }
    reader.onerror = () => resolve(null)
    reader.readAsText(file.slice(0, 2000), 'latin1')
  })
}

const MESES = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

export function useUploadSped() {
  const isUploading = ref(false)
  const uploadProgress = ref(0)
  const uploadMessage = ref('')
  const showSequenciaModal = ref(false)
  const sequenciaInfo = ref(null)

  let pendingFile = null
  let pendingOnSuccess = null

  async function verificarSequenciaPeriodo(file) {
    const header = await parseSpedHeader(file)
    if (!header || !header.cnpj || !header.dtIni) return true // não conseguiu ler → prossegue

    const mesNovo = parseInt(header.dtIni.substring(2, 4))
    const anoNovo = parseInt(header.dtIni.substring(4, 8))
    if (!mesNovo || !anoNovo) return true

    try {
      const resEmpresas = await axios.get(`${API_BASE_URL}/api/empresas?busca=${header.cnpj}`)
      const empresa = resEmpresas.data?.find(e => e.cnpj?.replace(/\D/g, '') === header.cnpj)
      if (!empresa) return true // empresa nova, sem histórico

      const resArquivos = await axios.get(`${API_BASE_URL}/api/arquivos/${empresa.id}`)
      const arquivos = resArquivos.data || []
      if (arquivos.length === 0) return true

      const periodos = arquivos
        .map(a => {
          const p = a.periodo_apuracao || ''
          return { mes: parseInt(p.substring(5, 7)), ano: parseInt(p.substring(0, 4)) }
        })
        .filter(p => p.mes && p.ano)
        .sort((a, b) => (a.ano !== b.ano ? b.ano - a.ano : b.mes - a.mes))

      if (periodos.length === 0) return true
      const ultimo = periodos[0]

      const mesEsperado = ultimo.mes === 12 ? 1 : ultimo.mes + 1
      const anoEsperado = ultimo.mes === 12 ? ultimo.ano + 1 : ultimo.ano
      if (mesNovo === mesEsperado && anoNovo === anoEsperado) return true // sequencial

      sequenciaInfo.value = {
        empresa: empresa.nome_empresa,
        ultimoPeriodo: `${MESES[ultimo.mes]}/${ultimo.ano}`,
        novoPeriodo: `${MESES[mesNovo]}/${anoNovo}`,
        esperado: `${MESES[mesEsperado]}/${anoEsperado}`,
      }
      return false
    } catch (e) {
      console.warn('Erro ao verificar sequência:', e)
      return true // em caso de erro, prossegue
    }
  }

  // Ponto de entrada: recebe o arquivo e um callback de sucesso ({ id, fileInfo, file }).
  async function selecionarArquivo(file, onSuccess) {
    if (!file) return
    const sequencial = await verificarSequenciaPeriodo(file)
    if (!sequencial) {
      pendingFile = file
      pendingOnSuccess = onSuccess
      showSequenciaModal.value = true
      return
    }
    await executarUpload(file, onSuccess)
  }

  function confirmarSequencia() {
    showSequenciaModal.value = false
    const file = pendingFile
    const cb = pendingOnSuccess
    pendingFile = null
    pendingOnSuccess = null
    if (file) executarUpload(file, cb)
  }

  function cancelarSequencia() {
    showSequenciaModal.value = false
    pendingFile = null
    pendingOnSuccess = null
  }

  async function executarUpload(file, onSuccess) {
    isUploading.value = true
    uploadProgress.value = 0
    uploadMessage.value = `Enviando ${file.name}…`

    const formData = new FormData()
    formData.append('spedfile', file)

    try {
      let response
      try {
        response = await axios.post(`${API_BASE_URL}/api/upload`, formData, {
          onUploadProgress: (evt) => {
            const pct = Math.round((evt.loaded * 100) / (evt.total || 1))
            uploadProgress.value = pct
            if (pct === 100) uploadMessage.value = 'Enviado. Processando no servidor (pode levar um minuto)…'
          },
        })
      } catch (err) {
        if (err.response && err.response.status === 409) {
          const repairedId = err.response.data.arquivo_id
          const msg = err.response.data.message || ''
          if (msg.includes('REPARADO') && repairedId) {
            // Auditoria já existia e o servidor reparou o arquivo físico; segue com o id.
            response = { data: { id_sped_arquivo: repairedId, fileInfo: null } }
          } else if (confirm('Este período já foi processado. Deseja SOBRESCREVER os dados antigos? (Isso apagará seus ajustes de LMC)')) {
            uploadMessage.value = 'Sobrescrevendo dados anteriores…'
            response = await axios.post(`${API_BASE_URL}/api/upload?overwrite=true`, formData)
          } else {
            return // cancelado pelo usuário
          }
        } else {
          throw err
        }
      }

      const id = response.data.id_sped_arquivo
      if (onSuccess) await onSuccess({ id, fileInfo: response.data.fileInfo, file })
    } catch (error) {
      alert('Falha no upload: ' + (error.response?.data?.message || error.message))
    } finally {
      isUploading.value = false
    }
  }

  return {
    isUploading,
    uploadProgress,
    uploadMessage,
    showSequenciaModal,
    sequenciaInfo,
    selecionarArquivo,
    confirmarSequencia,
    cancelarSequencia,
  }
}
