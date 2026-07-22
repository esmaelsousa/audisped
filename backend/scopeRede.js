// backend/scopeRede.js — isolamento por rede (Fase 1). Ver plano 2026-07-19.
const { ROLES_CROSS_TENANT } = require('./authz');

// Marcador de serviço: um CLAIM ASSINADO dedicado no token interno de revalidar/relatorio
// (server.js:6805/6907), NUNCA um email. Email é spoofável (criação de usuário, PUT profile),
// então confiar em user.email === 'sys@local' seria um bypass forjável. O claim `svc` só
// pode existir num token assinado com JWT_SECRET → inforjável sem o segredo.
const SVC_CLAIM = 'validador';
// Email legado do marcador de serviço: bloqueado na criação/edição de usuário para que
// ninguém ocupe esse namespace (defesa em profundidade; o bypass já não depende dele).
const EMAIL_SERVICO_LEGADO = 'sys@local';

function ehBypass(ator, user) {
  if (ator && ROLES_CROSS_TENANT.includes(ator.role)) return true;   // super_admin/staff
  if (user && user.svc === SVC_CLAIM) return true;                   // token de serviço (claim assinado)
  return false;
}

// Emails reservados/ inválidos: bloqueados na criação e edição de usuário.
//   - 'sys@local' (marcador de serviço legado): impede colisão de namespace.
//   - qualquer não-endereço: fecha a porta a identificadores forjados fora do formato email.
// Retorna true se o email NÃO pode ser usado por um usuário humano.
function emailReservado(email) {
  if (typeof email !== 'string') return true;
  const e = email.trim().toLowerCase();
  if (e === EMAIL_SERVICO_LEGADO) return true;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return true; // exige local@dominio.tld
  return false;
}

// Resolve a rede DONA do recurso pedido. null = não existe; undefined = tipo sem id.
async function redeDoRecurso(pool, tipo, req) {
  const p = req.params || {};
  if (tipo === 'empresa') {
    const id = p.id_empresa ?? p.id;
    if (id == null) return undefined;
    const r = await pool.query('SELECT rede_id FROM empresas WHERE id = $1', [id]);
    return r.rows.length ? r.rows[0].rede_id : null;
  }
  if (tipo === 'sped') { // :id_sped/:id_arquivo/:id → arquivo → empresa → rede
    const id = p.id_sped ?? p.id_arquivo ?? p.id;
    if (id == null) return undefined;
    const r = await pool.query(
      `SELECT e.rede_id FROM sped_arquivos s JOIN empresas e ON e.id = s.id_empresa WHERE s.id = $1`, [id]);
    return r.rows.length ? r.rows[0].rede_id : null;
  }
  throw new Error(`scopeRede: tipo desconhecido '${tipo}'`);
}

function scopeRede(pool, tipo) {
  return async (req, res, next) => {
    try {
      if (ehBypass(req.ator, req.user)) return next();
      if (!req.ator || req.ator.rede_id == null)
        return res.status(403).json({ erro: 'Sessão sem rede definida.' });
      const redeDona = await redeDoRecurso(pool, tipo, req);
      if (redeDona === undefined) return res.status(400).json({ erro: 'Recurso não identificado.' });
      if (redeDona === null) return res.status(404).json({ erro: 'Recurso não encontrado.' });
      if (redeDona !== req.ator.rede_id) return res.status(403).json({ erro: 'Sem acesso a este recurso.' });
      return next();
    } catch (e) { return res.status(500).json({ erro: 'Falha na verificação de acesso.' }); }
  };
}

module.exports = { ehBypass, redeDoRecurso, scopeRede, emailReservado, SVC_CLAIM, EMAIL_SERVICO_LEGADO };
