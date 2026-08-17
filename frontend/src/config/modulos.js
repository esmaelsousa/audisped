// Catálogo de módulos do cockpit — fonte única do gating de plano no frontend.
//
// Classificação PROVISÓRIA (core vs vendável) — é uma decisão de NEGÓCIO ainda
// em aberto (ver docs/superpowers/specs/2026-07-15-cockpit-hub-design.md §5). Este
// arquivo é o único ponto de verdade da UI: reclassificar um módulo aqui NÃO exige
// mexer em nenhuma tela. Os valores abaixo espelham o catálogo do plano SaaS atual
// (PLANO_CONTROLE_USUARIOS_SAAS.md §2.6). Quando o backend publicar backend/modulos.js,
// este vira fallback.
//
// core     = sempre visível para conta ativa (não vendável isoladamente).
// vendável = só aparece liberado se contratado (redes.modulos_contratados / usuarios.modulos).

export const MODULOS_CORE = new Set([
  'analisador',   // Auditoria (Motor)
  'catalogo',     // Catálogo de Regras
  'gestao_speds', // Repositório de arquivos (pseudo-chave só de front; sempre disponível)
])

export const MODULOS_VENDAVEIS = new Set([
  'validador',
  'livro_lmc',
  'injetor_xml',
  'injetor_cte',
  'conciliacao',
  'rentabilidade',
  'de_para',
  'regras_fiscais',
  'cfops',
  'impressao_lmc',
  'manifesto_nfe',
])

const PAPEIS_INTERNOS = new Set(['super_admin', 'staff'])

export function isInterno(usuario) {
  return PAPEIS_INTERNOS.has(usuario?.role)
}

// Conjunto efetivo de chaves que o usuário pode acessar.
//
// Fail-open deliberado durante o rollout: interno vê tudo, e quem NÃO tem um array
// `modulos` explícito (sessões legadas / usuários internos sem grants) também vê tudo.
// Só um usuário externo com `modulos` definido é de fato restringido. Isso evita
// quebrar o uso atual (só há usuários internos hoje) e passa a valer de verdade quando
// o cliente externo entrar — momento em que o enforcement REAL vem do backend (Fase 1).
export function modulosPermitidos(usuario) {
  const todos = new Set([...MODULOS_CORE, ...MODULOS_VENDAVEIS])
  if (isInterno(usuario) || !Array.isArray(usuario?.modulos)) return todos

  const grants = new Set(usuario.modulos)
  const permitidos = new Set(MODULOS_CORE)
  for (const chave of MODULOS_VENDAVEIS) {
    if (grants.has(chave)) permitidos.add(chave)
  }
  return permitidos
}

export function podeAcessar(chave, usuario) {
  if (!chave) return true
  return modulosPermitidos(usuario).has(chave)
}

// Mapa nome-da-rota → chave de módulo, para a guarda presentacional no router.
// Rotas core não entram aqui (sempre liberadas).
export const ROTA_PARA_MODULO = {
  validador: 'validador',
  lmc: 'livro_lmc',
  'injetor-xml': 'injetor_xml',
  'injetor-cte': 'injetor_cte',
  'de-para-xml': 'de_para',
  'regras-fiscais': 'regras_fiscais',
  cfops: 'cfops',
  'impressao-lmc': 'impressao_lmc',
  mde: 'manifesto_nfe',
  rentabilidade: 'rentabilidade',
}
