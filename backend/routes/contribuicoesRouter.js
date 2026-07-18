// Router do módulo EFD-Contribuições (ISOLADO). Montado no server.js com 1 linha:
//   app.use('/api/contribuicoes', require('./routes/contribuicoesRouter')(pool, authMiddleware));
//
// Factory: recebe o pool e o authMiddleware existentes (reusa, não cria outro pool).
// FASE 1: upload (parseia + grava) e exportar (remonta byte-idêntico). Sem injeção.

const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const { parseContribuicoes, salvarArquivo, exportarArquivo } = require('../services/spedContribuicoesService');

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
      const id = await salvarArquivo(pool, {
        id_empresa: req.body.id_empresa || null,
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
  router.get('/exportar/:id', authMiddleware, async (req, res) => {
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
