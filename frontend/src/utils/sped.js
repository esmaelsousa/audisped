/**
 * Utilitários SPED compartilhados entre AppSidebar e AppTopbar.
 * Extraídos para evitar duplicação (DRY).
 */

import { arquivoInfo } from '@/store'

export function formatCnpj(cnpj) {
  if (!cnpj) return ''
  const c = String(cnpj).replace(/\D/g, '')
  if (c.length !== 14) return cnpj
  return c.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
}

export function competencia() {
  if (!arquivoInfo.value) return null
  const a = arquivoInfo.value
  if (a.competencia) return a.competencia
  if (a.periodo) return a.periodo
  if (a.dt_ini) {
    const s = String(a.dt_ini)
    if (s.length === 8) return s.slice(2, 4) + '/' + s.slice(4)
    return s
  }
  return null
}

export function layoutVer() {
  if (!arquivoInfo.value) return null
  return arquivoInfo.value.cod_ver || arquivoInfo.value.versao || null
}
