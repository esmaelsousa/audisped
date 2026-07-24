// Router do módulo EFD-Contribuições (ISOLADO). Montado no server.js com 1 linha:
//   app.use('/api/contribuicoes', require('./routes/contribuicoesRouter')(pool, authMiddleware));
//
// Factory: recebe o pool e o authMiddleware existentes (reusa, não cria outro pool).
// FASE 1: upload (parseia + grava) e exportar (remonta byte-idêntico). Sem injeção.

const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const { parseContribuicoes, salvarArquivo, exportarArquivo } = require('../services/spedContribuicoesService');
// Fase 1 (isolamento por rede): o export deste módulo era um IDOR cross-tenant real
// (exportarArquivo faz SELECT ... WHERE id=$1 sem filtro de rede). scopeRede('sped') resolve
// efd_contrib_arquivos.id → id_empresa → empresas.rede_id e barra ator de outra rede (403).
const { scopeRede, ehBypass } = require('../scopeRede');

module.exports = (pool, authMiddleware) => {
  const router = express.Router();
  // Arquivo pequeno (EFD-Contribuições de posto/comércio) → memória, sem temp em disco.
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

  // POST /api/contribuicoes/upload  — campo 'contribfile' (+ id_empresa opcional)
  router.post('/upload', authMiddleware, upload.single('contribfile'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'Envie o arquivo .txt da EFD-Contribuições (campo "contribfile").' });
      const txt = req.file.buffer.toString('latin1'); // preserva bytes (latin-1)
      const parsed = parseContribuicoes(txt);
      const sha = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

      // --- WRITE-PATH (Fase 1): o arquivo nasce amarrado à rede do ator via id_empresa ---
      //   id_empresa informado → tem que ser da rede do ator (senão 403; sem isso, Rede B escreveria
      //     sob a empresa da Rede A e depois exportaria o dado dela via /exportar/:id).
      //   sem id_empresa → tenta casar a empresa da PRÓPRIA rede pelo CNPJ do arquivo (binding do export).
      //   super_admin/staff (bypass) → operam livre (id_empresa como veio; pode ser null).
      const bypass = ehBypass(req.ator, req.user);
      const atorRede = (req.ator && req.ator.rede_id != null) ? req.ator.rede_id : null;
      let idEmpresa = req.body.id_empresa || null;
      if (!bypass) {
        if (atorRede == null) return res.status(403).json({ message: 'Sessão sem rede definida.' });
        if (idEmpresa != null) {
          const r = await pool.query('SELECT rede_id FROM empresas WHERE id = $1', [idEmpresa]);
          const redeDona = r.rows.length ? r.rows[0].rede_id : null;
          if (redeDona == null || redeDona !== atorRede)
            return res.status(403).json({ message: 'Empresa informada não pertence à sua rede.' });
        } else {
          const cnpj = parsed.meta && parsed.meta.cnpj ? String(parsed.meta.cnpj).replace(/\D/g, '') : null;
          if (cnpj) {
            const r = await pool.query(
              "SELECT id FROM empresas WHERE regexp_replace(cnpj,'[^0-9]','','g') = $1 AND rede_id = $2",
              [cnpj, atorRede]);
            if (r.rows.length === 1) idEmpresa = r.rows[0].id;
          }
        }
      }

      const id = await salvarArquivo(pool, {
        id_empresa: idEmpresa,
        nome_original: req.file.originalname,
        parsed,
        sha256: sha,
      });
      res.json({ id, meta: parsed.meta, total_linhas: parsed.linhas.length, sha256: sha });
    } catch (e) {
      console.error('[contribuicoes/upload]', e);
      res.status(500).json({ message: 'Falha ao processar EFD-Contribuições: ' + e.message });
    }
  });

  // GET /api/contribuicoes/exportar/:id  — download byte-idêntico (Fase 1)
  router.get('/exportar/:id', authMiddleware, scopeRede(pool, 'contrib'), async (req, res) => {
    try {
      const out = await exportarArquivo(pool, req.params.id);
      if (!out) return res.status(404).json({ message: 'Arquivo não encontrado.' });
      const buf = Buffer.from(out.conteudo, 'latin1');
      const nome = out.arquivo.nome_original || `efd_contrib_${req.params.id}.txt`;
      res.setHeader('Content-Type', 'text/plain; charset=iso-8859-1');
      res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
      res.send(buf);
    } catch (e) {
      console.error('[contribuicoes/exportar]', e);
      res.status(500).json({ message: 'Falha ao exportar: ' + e.message });
    }
  });

  return router;
};
