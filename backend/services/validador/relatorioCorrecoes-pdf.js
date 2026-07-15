// Relatório consolidado de CORREÇÕES do SPED (PDF) — documento para o contribuinte enviar à
// contabilidade / setor fiscal. Layout inspirado no laudo de auditoria: identificação, cards por
// "Correção sugerida" (descrição em linguagem natural + ocorrências NF a NF), pendências restantes
// (o que o Validador ainda aponta), e correções desligadas. NÃO recalcula nada — só formata os dados.
// Sem caracteres fora do WinAnsi (usa "de X para Y", não a seta →) para não quebrar na fonte embutida.
// Uso: const doc = new PDFDocument(...); gerarRelatorioCorrecoes(doc, dados); doc.end();

const M = 36;                 // margem
const COR_TEXTO = '#0f172a';
const COR_SUAVE = '#64748b';
const COR_LINHA = '#e2e8f0';
const COR_OK = '#047857';
const COR_ALERTA = '#b45309';
const COR_AZUL_BG = '#eff6ff';
const COR_AZUL_BORDA = '#bfdbfe';
const COR_AZUL_TXT = '#1e40af';

const LABEL_REGRA = {
    'INV-E116-01': 'Injeção do E116 (ICMS a recolher)',
    'CAD-0150-08': 'Cadastro 0150 da credenciadora (1601)',
    'COMB-1350-1360-01': 'Injeção de lacres (1360)',
    'COMB-CST-01': 'CST 61 para 60 (antes da vigência monofásica)',
    'DOC-C170-CFOP-01': 'Correção de CFOP de entrada',
    'USO-CONSUMO-X90': 'Uso/consumo para CST do grupo x90',
    'DOC-C100-VLDOC-01': 'VL_DOC do C100 divergente (despesa acessória espúria)',
    'DOC-C170-ICMSSEMBASE-01': 'ICMS/alíquota do C170 sem base',
    'DOC-C190-ICMSSEMBASE-01': 'ICMS/alíquota do C190 sem base',
    'DOC-C190-REDBC-01': 'VL_RED_BC sem redução de base',
    'DOC-C100-SER-01': 'Série do C100 alinhada à chave de acesso',
    'DOC-C100-5929-01': 'CFOP 5929 (espelho de ECF): ICMS duplicado removido',
    'CADASTRO': 'Correção de dado cadastral (IE / contabilista)',
};

// Texto "Correção sugerida" (linguagem natural) por regra — estilo do laudo de auditoria.
const DESCRICAO_SUGESTAO = {
    'USO-CONSUMO-X90': 'Identificamos aquisição de uso/consumo com CST/CFOP indicando crédito de ICMS indevido; o CST foi ajustado para o grupo x90 e a base/alíquota/ICMS foram zerados na operação sem direito a crédito.',
    'DOC-C100-VLDOC-01': 'O valor total do documento (VL_DOC) estava divergente da composição dos itens por despesa acessória indevida; o valor foi ajustado.',
    'DOC-C170-ICMSSEMBASE-01': 'ICMS e alíquota informados no item (C170) sem base de cálculo tributável; os valores foram ajustados.',
    'DOC-C190-ICMSSEMBASE-01': 'ICMS e alíquota informados na consolidação (C190) sem base de cálculo tributável; os valores foram ajustados.',
    'DOC-C190-REDBC-01': 'Valor de redução de base (VL_RED_BC) informado sem redução de base de cálculo; o valor foi ajustado.',
    'COMB-CST-01': 'CST 61 informado antes da vigência da tributação monofásica; ajustado para CST 60.',
    'DOC-C170-CFOP-01': 'CFOP de entrada incorreto no item; o CFOP foi corrigido.',
    'DOC-C100-SER-01': 'A série informada no documento (campo SER do C100) divergia da série contida na chave de acesso; a série foi alinhada à chave, que é a identidade do documento fiscal.',
    'DOC-C100-5929-01': 'Nota de CFOP 5929 (espelho de operação já tributada no cupom/ECF): o ICMS duplicado foi removido do C190 e do cabeçalho C100, e o débito foi decrementado da apuração (E110), evitando bitributação.',
    'INV-E116-01': 'Registro E116 (ICMS a recolher) ausente; o registro foi injetado para conciliar a apuração.',
    'INV-H005-01': 'Data do inventário (H005) fora do período de apuração; a data foi ajustada.',
    'INV-H010-01': 'Valor do inventário (VL_INV no H005) divergente da soma dos itens (H010); o total foi ajustado.',
    'CAD-0150-08': 'Cadastro do participante (0150) da credenciadora ausente; o cadastro foi injetado.',
    'COMB-1350-1360-01': 'Lacres das bombas (registro 1360) ausentes; os lacres cadastrados foram injetados.',
    'CADASTRO': 'Correção de dado cadastral (Inscrição Estadual / contabilista).',
    'RECONCILIACAO': 'Atualização dos totalizadores de registros (9900 / 9990 / 9999) para refletir as alterações feitas no arquivo.',
};

// Remove os sufixos técnicos do motivo ("— correção manual", "· N ocorrência(s)") p/ usar como descrição.
function limparMotivo(m) {
    return String(m || '')
        .replace(/\s*·\s*\d+\s*ocorrência\(s\).*$/i, '')
        .replace(/\s*[—-]\s*(correção manual|“Corrigir todas as seguras”).*$/i, '')
        .trim();
}

// Reagrupa o changelog (bloco→registro→entradas) por "Correção sugerida" (regra), no estilo do painel:
// cada card = uma regra, com a descrição em linguagem natural e a lista de ocorrências (expandidas NF a NF
// quando há itens[]). `total` soma as quantidades reais. Ordena por total desc.
function agruparPorSugestao(agrupado) {
    const grupos = new Map();
    for (const b of (agrupado || [])) {
        for (const reg of (b.registros || [])) {
            for (const it of (reg.itens || [])) {
                const key = it.regraId || it.motivo || it.registro || '?';
                const g = grupos.get(key) || {
                    regraId: it.regraId || '',
                    descricao: DESCRICAO_SUGESTAO[it.regraId] || limparMotivo(it.motivo) || LABEL_REGRA[it.regraId] || it.regraId || 'Correção aplicada',
                    total: 0, correcoes: [],
                };
                if (Array.isArray(it.itens) && it.itens.length) {
                    for (const d of it.itens) {
                        g.correcoes.push({ registro: it.registro, chave: d.chave != null ? d.chave : null, campo: it.campo || '', antes: d.antes, depois: d.depois });
                        g.total++;
                    }
                } else {
                    g.correcoes.push({ registro: it.registro, chave: null, campo: it.campo || '', antes: it.antes, depois: it.depois });
                    g.total += (it.qtd || 1);
                }
                grupos.set(key, g);
            }
        }
    }
    return [...grupos.values()].sort((a, b) => b.total - a.total);
}

// Agrupa os erros que RESTARAM após as correções (pendências) por regra, para o laudo listar
// "o que ainda precisa de atenção". BLOQ (bloqueante) primeiro; depois por quantidade. Cada grupo
// guarda os itens individuais (registro/linha/campo/detalhe) para o detalhamento item a item.
function agruparPendencias(erros) {
    const grupos = new Map();
    for (const e of (erros || [])) {
        const key = e.regra_id || e.titulo || e.registro || '?';
        const g = grupos.get(key) || { regra_id: e.regra_id || '', titulo: e.titulo || '', registro: e.registro || '', severidade: 'ADV', total: 0, itens: [] };
        g.total++;
        if (e.severidade === 'BLOQ') g.severidade = 'BLOQ';
        if (!g.registro && e.registro) g.registro = e.registro;
        g.itens.push({ registro: e.registro || '', linha: (e.linha != null ? e.linha : null), campo: e.campo || '', detalhe: e.detalhe || '' });
        grupos.set(key, g);
    }
    return [...grupos.values()].sort((a, b) =>
        a.severidade === b.severidade ? b.total - a.total : (a.severidade === 'BLOQ' ? -1 : 1));
}

function gerarRelatorioCorrecoes(doc, dados) {
    const W = doc.page.width - M * 2;
    const limiteY = () => doc.page.height - 46; // espaço p/ o rodapé
    const ensure = (h) => { if (doc.y + h > limiteY()) doc.addPage(); };
    const fmtVal = (v) => { const s = String(v == null ? '' : v).trim(); return s === '' ? '(vazio)' : s; };

    // Caixa "Correção sugerida" (header azul do card), altura calculada pelo texto.
    const boxSugestao = (texto) => {
        const padX = 10, padY = 7, labelH = 12;
        doc.font('Helvetica').fontSize(8.5);
        const h = padY * 2 + labelH + doc.heightOfString(texto || '', { width: W - padX * 2 });
        ensure(h + 26);
        const y0 = doc.y;
        doc.roundedRect(M, y0, W, h, 4).fillAndStroke(COR_AZUL_BG, COR_AZUL_BORDA);
        doc.font('Helvetica-Bold').fontSize(9).fillColor(COR_AZUL_TXT).text('Correção sugerida', M + padX, y0 + padY);
        doc.font('Helvetica').fontSize(8.5).fillColor('#1e3a5f').text(texto || '', M + padX, y0 + padY + labelH, { width: W - padX * 2 });
        doc.y = y0 + h + 6;
    };
    // Nota informativa (caixa azul-clara com ícone "i").
    const notaBox = (texto) => {
        const padX = 24, padY = 6;
        doc.font('Helvetica').fontSize(8);
        const h = padY * 2 + doc.heightOfString(texto, { width: W - padX - 10 });
        ensure(h + 6);
        const y0 = doc.y;
        doc.roundedRect(M, y0, W, h, 4).fillAndStroke('#f0f9ff', '#bae6fd');
        doc.circle(M + 12, y0 + h / 2, 5).fill('#0284c7');
        doc.font('Helvetica-Bold').fontSize(7).fillColor('#ffffff').text('i', M + 10.2, y0 + h / 2 - 3.5);
        doc.font('Helvetica').fontSize(8).fillColor('#0c4a6e').text(texto, M + padX, y0 + padY, { width: W - padX - 10 });
        doc.y = y0 + h + 8;
    };

    // ── Cabeçalho ─────────────────────────────────────────────────────────────
    doc.rect(M, M, W, 3).fill('#0f172a');
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COR_TEXTO).text('AudiSped', M, M + 9, { continued: true });
    doc.font('Helvetica').fontSize(8).fillColor(COR_SUAVE).text('   Relatório de Correções — EFD ICMS/IPI');
    doc.font('Helvetica').fontSize(7.5).fillColor(COR_SUAVE).text(dados.geradoEm || '', M, M + 10, { width: W, align: 'right' });
    doc.y = M + 28;

    // ── Título + card de identificação ────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(13).fillColor(COR_TEXTO).text('Correções do arquivo', M, doc.y);
    doc.font('Helvetica').fontSize(9).fillColor(COR_SUAVE).text(dados.arquivo.nome || '—', M, doc.y + 1, { width: W });
    doc.moveDown(0.5);
    const idTop = doc.y;
    const idH = 66;
    doc.roundedRect(M, idTop, W, idH, 5).fillAndStroke('#f8fafc', COR_LINHA);
    const linhasId = [
        ['Empresa', dados.empresa.razao_social || '—', 'CNPJ', dados.empresa.cnpj || '—'],
        ['Período de apuração', dados.arquivo.periodo || '—', 'Obrigação', 'EFD-ICMS/IPI'],
        ['Total de correções aplicadas', String(dados.resumo.total || 0), 'Leiaute (COD_VER) · IE', `${dados.arquivo.versao || '—'} · ${dados.empresa.ie || '—'}`],
    ];
    let yi = idTop + 9;
    for (const [l1, v1, l2, v2] of linhasId) {
        doc.font('Helvetica').fontSize(7).fillColor(COR_SUAVE).text(l1.toUpperCase(), M + 12, yi, { width: W / 2 - 22 });
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COR_TEXTO).text(v1, M + 12, yi + 8, { width: W / 2 - 22 });
        doc.font('Helvetica').fontSize(7).fillColor(COR_SUAVE).text(l2.toUpperCase(), M + W / 2 + 6, yi, { width: W / 2 - 16 });
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COR_TEXTO).text(v2, M + W / 2 + 6, yi + 8, { width: W / 2 - 16 });
        yi += 19;
    }
    doc.y = idTop + idH + 12;

    // ── Detalhamento dos logs de correção ─────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(11.5).fillColor(COR_TEXTO).text('Detalhamento dos logs de correção', M, doc.y);
    doc.moveTo(M, doc.y + 3).lineTo(M + W, doc.y + 3).strokeColor(COR_LINHA).lineWidth(0.8).stroke();
    doc.moveDown(0.6);
    notaBox('As correções abaixo já foram aplicadas ao SPED corrigido (o arquivo que você baixa). Este laudo é informativo e não substitui a validação no PVA — a transmissão é de responsabilidade do contribuinte.');

    const cards = agruparPorSugestao(dados.agrupado);
    if (!cards.length) {
        doc.font('Helvetica-Oblique').fontSize(9).fillColor(COR_SUAVE)
            .text('Nenhuma correção aplicada — o SPED já estava coerente nos pontos verificados.', M, doc.y);
    }
    for (const card of cards) {
        boxSugestao(card.descricao);
        doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(COR_TEXTO).text(`Quantidade de ocorrências corrigidas: ${card.total}`, M + 2, doc.y);
        doc.moveDown(0.15);
        doc.font('Helvetica-BoldOblique').fontSize(8.5).fillColor(COR_TEXTO).text('Correções realizadas:', M + 2, doc.y);
        doc.moveDown(0.25);
        for (const c of card.correcoes) {
            ensure(14);
            let s = `Registro afetado: ${c.registro || '—'}`;
            if (c.chave) s += `  -  NF / Chave: ${c.chave}`;
            if (c.campo) s += `  -  ${c.campo}`;
            s += `: valor alterado de ${fmtVal(c.antes)} para ${fmtVal(c.depois)}.`;
            doc.font('Helvetica-Oblique').fontSize(8).fillColor('#334155').text(s, M + 8, doc.y, { width: W - 14 });
            doc.moveDown(0.25);
        }
        doc.moveDown(0.5);
    }

    // ── Pendências após as correções (o que o Validador ainda aponta) ──────────
    const pend = dados.pendencias || [];
    if (pend.length) {
        ensure(46);
        doc.moveDown(0.3);
        doc.font('Helvetica-Bold').fontSize(11.5).fillColor(COR_ALERTA).text('Pendências após as correções', M, doc.y);
        doc.moveTo(M, doc.y + 3).lineTo(M + W, doc.y + 3).strokeColor('#fcd34d').lineWidth(0.8).stroke();
        doc.moveDown(0.5);
        doc.font('Helvetica').fontSize(8).fillColor(COR_SUAVE)
            .text('Pontos que o Validador ainda aponta no arquivo corrigido e dependem de análise/decisão. Advertências não impedem a transmissão; bloqueantes (se houver) sim.', M, doc.y, { width: W });
        doc.moveDown(0.5);
        for (const p of pend) {
            ensure(28);
            const sev = p.severidade === 'BLOQ' ? 'BLOQUEANTE' : 'ADVERTÊNCIA';
            const cor = p.severidade === 'BLOQ' ? '#b91c1c' : COR_ALERTA;
            const titulo = LABEL_REGRA[p.regra_id] || DESCRICAO_SUGESTAO[p.regra_id] || p.titulo || p.regra_id || p.registro || 'Pendência';
            doc.font('Helvetica-Bold').fontSize(8.8).fillColor(cor).text(`${sev}  ·  ${titulo}  (${p.total})`, M + 2, doc.y, { width: W - 4 });
            doc.moveDown(0.15);
            for (const it of p.itens) {
                ensure(12);
                const txt = it.detalhe || `${it.registro || ''}${it.campo ? '  ·  ' + it.campo : ''}`;
                doc.font('Helvetica').fontSize(7.5).fillColor('#475569').text(`-  ${txt}`, M + 10, doc.y, { width: W - 16 });
                doc.moveDown(0.12);
            }
            doc.moveDown(0.4);
        }
    }

    // ── Correções desligadas pelo usuário ─────────────────────────────────────
    if (dados.skips && dados.skips.length) {
        ensure(50);
        doc.moveDown(0.3);
        doc.font('Helvetica-Bold').fontSize(10).fillColor(COR_ALERTA).text('Correções DESLIGADAS pelo usuário (não aplicadas)', M, doc.y);
        doc.font('Helvetica').fontSize(8).fillColor(COR_SUAVE).text('O erro correspondente pode permanecer no arquivo. Decisão do contribuinte.', M);
        doc.moveDown(0.2);
        for (const s of dados.skips) {
            ensure(16);
            const rot = LABEL_REGRA[s.regra_id] || s.regra_id;
            doc.font('Helvetica').fontSize(8.5).fillColor(COR_TEXTO)
                .text(`-  ${rot}${s.chave ? '  ·  ' + s.chave : ''}`, M + 6, doc.y, { width: W - 12 });
        }
    }

    // ── Rodapé em todas as páginas (bufferPages) ──────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc.page.margins.bottom = 0; // escrever no rodapé (abaixo da margem) sem o pdfkit auto-adicionar página
        const fy = doc.page.height - 30;
        doc.font('Helvetica').fontSize(6.5).fillColor('#94a3b8');
        doc.text('AudiSped · audisped.com.br — relatório informativo; NÃO substitui a validação no PVA. A transmissão do SPED é de responsabilidade do contribuinte.', M, fy, { width: W - 70, lineBreak: false });
        const pg = `Página ${i - range.start + 1} de ${range.count}`;
        doc.text(pg, M + W - 70, fy, { width: 70, align: 'right', lineBreak: false });
    }
}

module.exports = { gerarRelatorioCorrecoes, agruparPendencias, agruparPorSugestao };
