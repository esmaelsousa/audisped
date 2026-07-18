// ============================================================================
// spedContribuicoesService — Injetor EFD-Contribuições (PIS/COFINS)
// ----------------------------------------------------------------------------
// MÓDULO NOVO E ISOLADO. Não altera nada do Fiscal (xmlInjectorService,
// spedCostureiraService, cteInjectorService) nem as tabelas documentos_*.
// Ver PLANO_INJETOR_XML_CONTRIBUICOES.md.
//
// FASE 1 (esta): parser round-trip. Importa o .txt preservando TUDO como raw
// (latin-1, CRLF, ordem das linhas) e remonta BYTE-A-BYTE idêntico. A geração
// de registros (C100/C170/0500/Bloco M) e a costura vêm nas fases seguintes,
// por cima desta fundação provada pelo arnês golden (tests/contrib-roundtrip).
// ============================================================================

'use strict';

// Detecta o terminador de linha dominante (SPED é CRLF; caímos p/ LF se preciso).
function detectarEol(txt) {
  return txt.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
}

// REG = 2º campo (entre o 1º e o 2º '|'). Linha em branco → ''.
function regDaLinha(raw) {
  const p = raw.split('|');
  return (p[1] || '').trim();
}

// Bloco = 1º caractere do REG (ex.: '0000'→'0', 'C100'→'C', 'M200'→'M', '9999'→'9').
function blocoDoReg(reg) {
  return reg ? reg.charAt(0) : '';
}

// Extrai metadados do cabeçalho (0000) e do regime (0110), sem afetar o raw.
// 0000: |0000|COD_VER|TIPO_ESCRIT|IND_SIT|NUM_REC|DT_INI|DT_FIN|NOME|CNPJ|UF|...
//        (índices split('|'): 6=DT_INI, 7=DT_FIN, 9=CNPJ)
// 0110: |0110|COD_INC_TRIB|... (índice 2 = regime: 1 não-cumul., 2 cumul., 3 ambos)
function extrairMeta(linhas) {
  const meta = { cnpj: null, dtIni: null, dtFin: null, competencia: null, regime: null, codVer: null };
  for (const l of linhas) {
    if (l.reg === '0000') {
      const f = l.raw.split('|');
      meta.codVer = f[2] || null;
      meta.dtIni = f[6] || null;
      meta.dtFin = f[7] || null;
      meta.cnpj = f[9] || null;
      if (meta.dtIni && meta.dtIni.length === 8) {
        meta.competencia = meta.dtIni.slice(2, 4) + '/' + meta.dtIni.slice(4, 8); // MM/AAAA
      }
    } else if (l.reg === '0110') {
      const f = l.raw.split('|');
      meta.regime = f[2] || null;
    }
    if (meta.cnpj && meta.regime) break;
  }
  return meta;
}

// parseContribuicoes(txt) → representação fiel:
//   { eol, trailingEol, linhas:[{num,reg,bloco,raw}], meta }
// Preserva ordem e conteúdo exatos de cada linha (o raw é a fonte de verdade).
function parseContribuicoes(txt) {
  const eol = detectarEol(txt);
  let partes = txt.split(eol);

  // Um EOL no fim do arquivo cria um último elemento '' — registramos e removemos.
  let trailingEol = false;
  if (partes.length > 0 && partes[partes.length - 1] === '') {
    trailingEol = true;
    partes = partes.slice(0, -1);
  }

  const linhas = partes.map((raw, i) => {
    const reg = regDaLinha(raw);
    return { num: i + 1, reg, bloco: blocoDoReg(reg), raw };
  });

  return { eol, trailingEol, linhas, meta: extrairMeta(linhas) };
}

// montarArquivo(parsed) → string reconstruída (a serializar em latin-1).
// Reconcatena as linhas na ordem original com o EOL preservado. Enquanto nada
// é injetado, é idêntico ao original (garantido pelo arnês golden).
function montarArquivo(parsed) {
  const eol = parsed.eol || '\r\n';
  const corpo = parsed.linhas.map(l => l.raw).join(eol);
  return corpo + (parsed.trailingEol ? eol : '');
}

// ---------------------------------------------------------------------------
// Persistência (Fase 1) — grava as linhas cruas e remonta a partir do banco.
// ---------------------------------------------------------------------------

// Grava o arquivo parseado. Retorna o id em efd_contrib_arquivos.
async function salvarArquivo(pool, { id_empresa, nome_original, parsed, sha256 }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const m = parsed.meta || {};
    const r = await client.query(
      `INSERT INTO efd_contrib_arquivos
         (id_empresa, cnpj, competencia, regime, cod_ver, dt_ini, dt_fin, nome_original, eol, trailing_eol, total_linhas, sha256)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [id_empresa || null, m.cnpj || null, m.competencia || null, m.regime || null, m.codVer || null,
       m.dtIni || null, m.dtFin || null, nome_original || null, parsed.eol, parsed.trailingEol,
       parsed.linhas.length, sha256 || null]
    );
    const id = r.rows[0].id;

    // Insere TODAS as linhas de uma vez (unnest) — sem loop de queries.
    const nums = [], regs = [], blocos = [], raws = [];
    for (const l of parsed.linhas) { nums.push(l.num); regs.push(l.reg); blocos.push(l.bloco); raws.push(l.raw); }
    await client.query(
      `INSERT INTO efd_contrib_linhas (id_arquivo, num_linha, reg, bloco, raw)
       SELECT $1, * FROM unnest($2::int[], $3::text[], $4::text[], $5::text[])`,
      [id, nums, regs, blocos, raws]
    );

    await client.query('COMMIT');
    return id;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Remonta o arquivo a partir do banco (Fase 1: byte-idêntico ao original).
// Retorna { arquivo, conteudo } ou null se não existir.
async function exportarArquivo(pool, id) {
  const a = await pool.query('SELECT * FROM efd_contrib_arquivos WHERE id = $1', [id]);
  if (!a.rows.length) return null;
  const arq = a.rows[0];
  const ls = await pool.query('SELECT raw FROM efd_contrib_linhas WHERE id_arquivo = $1 ORDER BY num_linha', [id]);
  const eol = arq.eol || '\r\n';
  const corpo = ls.rows.map(x => x.raw).join(eol);
  const conteudo = corpo + (arq.trailing_eol ? eol : '');
  return { arquivo: arq, conteudo };
}

module.exports = { parseContribuicoes, montarArquivo, salvarArquivo, exportarArquivo };
