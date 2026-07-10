// Relatório consolidado de CORREÇÕES do SPED (PDF) — documento para o contribuinte enviar à
// contabilidade / setor fiscal. Renderiza o changelog do export (val_alteracoes) de forma detalhada:
// identificação, resumo, detalhamento por bloco→registro (antes→depois + motivo + origem), correções
// que o usuário DESLIGOU, e situação após as correções. NÃO recalcula nada — só formata os dados.
// Uso: const doc = new PDFDocument(...); gerarRelatorioCorrecoes(doc, dados); doc.end();

const M = 36;                 // margem
const COR_TEXTO = '#0f172a';
const COR_SUAVE = '#64748b';
const COR_LINHA = '#e2e8f0';
const COR_OK = '#047857';
const COR_ALERTA = '#b45309';

const LABEL_ORIGEM = { injecao: 'Injeção', fiscal: 'Ajuste fiscal', manual: 'Manual', auto: 'Automático/estrutural', remocao: 'Remoção' };
const LABEL_REGRA = {
    'INV-E116-01': 'Injeção do E116 (ICMS a recolher)',
    'CAD-0150-08': 'Cadastro 0150 da credenciadora (1601)',
    'COMB-1350-1360-01': 'Injeção de lacres (1360)',
    'COMB-CST-01': 'CST 61→60 (antes da vigência monofásica)',
    'DOC-C170-CFOP-01': 'Correção de CFOP de entrada',
    'USO-CONSUMO-X90': 'Uso/consumo → CST x90',
    'DOC-C100-VLDOC-01': 'VL_DOC do C100 divergente (despesa acessória espúria)',
    'DOC-C170-ICMSSEMBASE-01': 'ICMS/alíquota do C170 sem base',
    'DOC-C190-ICMSSEMBASE-01': 'ICMS/alíquota do C190 sem base',
    'DOC-C190-REDBC-01': 'VL_RED_BC sem redução de base',
    'CADASTRO': 'Correção de dado cadastral (IE / contabilista)',
};

function gerarRelatorioCorrecoes(doc, dados) {
    const W = doc.page.width - M * 2;
    const limiteY = () => doc.page.height - 46; // espaço p/ o rodapé
    const ensure = (h) => { if (doc.y + h > limiteY()) doc.addPage(); };

    // ── Título ──────────────────────────────────────────────────────────────
    doc.fillColor(COR_TEXTO).font('Helvetica-Bold').fontSize(15)
        .text('Relatório de Correções — SPED Fiscal (EFD ICMS/IPI)', M, M);
    doc.font('Helvetica').fontSize(8).fillColor(COR_SUAVE)
        .text(`Documento gerado pelo AudiSped em ${dados.geradoEm}`, M, doc.y + 2);
    doc.moveDown(0.6);

    // ── Identificação ───────────────────────────────────────────────────────
    const idTop = doc.y;
    doc.rect(M, idTop, W, 64).fillAndStroke('#f8fafc', COR_LINHA);
    const linhasId = [
        ['Empresa', dados.empresa.razao_social || '—', 'Período de apuração', dados.arquivo.periodo || '—'],
        ['CNPJ', dados.empresa.cnpj || '—', 'Leiaute (COD_VER)', dados.arquivo.versao || '—'],
        ['Inscrição Estadual', dados.empresa.ie || '—', 'Total de linhas', String(dados.arquivo.totalLinhas || '—')],
    ];
    let yi = idTop + 8;
    for (const [l1, v1, l2, v2] of linhasId) {
        doc.font('Helvetica').fontSize(7).fillColor(COR_SUAVE).text(l1.toUpperCase(), M + 10, yi, { width: 110 });
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COR_TEXTO).text(v1, M + 10, yi + 8, { width: W / 2 - 20 });
        doc.font('Helvetica').fontSize(7).fillColor(COR_SUAVE).text(l2.toUpperCase(), M + W / 2 + 6, yi, { width: 120 });
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COR_TEXTO).text(v2, M + W / 2 + 6, yi + 8, { width: W / 2 - 16 });
        yi += 19;
    }
    doc.y = idTop + 64 + 10;

    // ── Resumo ──────────────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COR_TEXTO).text('Resumo', M, doc.y);
    doc.moveDown(0.2);
    const porOrigem = (dados.resumo && dados.resumo.porOrigem) || {};
    const partes = Object.keys(porOrigem).map(k => `${LABEL_ORIGEM[k] || k}: ${porOrigem[k]}`);
    doc.font('Helvetica').fontSize(9).fillColor(COR_TEXTO)
        .text(`${dados.resumo.total || 0} correção(ões) aplicada(s) no arquivo corrigido.`, M, doc.y);
    if (partes.length) doc.font('Helvetica').fontSize(8.5).fillColor(COR_SUAVE).text(partes.join('  ·  '), M, doc.y + 1);
    if (dados.skips && dados.skips.length) doc.font('Helvetica').fontSize(8.5).fillColor(COR_ALERTA).text(`${dados.skips.length} correção(ões) DESLIGADA(S) pelo usuário (não aplicada(s)).`, M, doc.y + 2);
    if (dados.residual) {
        const cor = dados.residual.bloqueantes ? '#b91c1c' : COR_OK;
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(cor)
            .text(`Situação após as correções: ${dados.residual.bloqueantes || 0} erro(s) bloqueante(s) e ${dados.residual.advertencias || 0} advertência(s) restante(s).`, M, doc.y + 2);
    }
    doc.moveDown(0.6);

    // ── Detalhamento por bloco → registro ────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COR_TEXTO).text('Detalhamento das correções', M, doc.y);
    doc.moveDown(0.3);

    if (!dados.agrupado || !dados.agrupado.length) {
        doc.font('Helvetica-Oblique').fontSize(9).fillColor(COR_SUAVE)
            .text('Nenhuma correção aplicada — o SPED já estava coerente nos pontos verificados.', M, doc.y);
    }
    for (const b of (dados.agrupado || [])) {
        ensure(40);
        doc.moveDown(0.4);
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#1e293b').text(`Bloco ${b.bloco}  ·  ${b.total} correção(ões)`, M, doc.y);
        doc.moveTo(M, doc.y + 1).lineTo(M + W, doc.y + 1).strokeColor(COR_LINHA).lineWidth(0.7).stroke();
        doc.moveDown(0.4);
        for (const reg of b.registros) {
            ensure(28);
            doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#4338ca').text(`${reg.registro}  (${reg.total})`, M + 4);
            for (const it of reg.itens) {
                ensure(30);
                const campo = it.campo || it.escopo || '';
                // linha 1: campo [×qtd] + origem + regra
                doc.font('Helvetica-Bold').fontSize(8).fillColor(COR_TEXTO).text(campo, M + 12, doc.y, { continued: true });
                if (it.qtd && it.qtd > 1) doc.font('Helvetica-Bold').fontSize(8).fillColor(COR_ALERTA).text(`  ×${it.qtd}`, { continued: true });
                doc.font('Helvetica').fontSize(7).fillColor(COR_SUAVE).text(`   [${LABEL_ORIGEM[it.origem] || it.origem}]${it.regraId ? '  ' + it.regraId : ''}`);
                // linha 2: antes → depois
                doc.font('Helvetica').fontSize(8).fillColor('#94a3b8').text((it.antes || '—') + '  ', M + 20, doc.y, { continued: true, width: W - 32 });
                doc.fillColor('#cbd5e1').text('→  ', { continued: true });
                doc.font('Helvetica-Bold').fillColor(COR_OK).text(it.depois || '—');
                // linha 3: motivo
                if (it.motivo) doc.font('Helvetica-Oblique').fontSize(7).fillColor(COR_SUAVE).text(it.motivo, M + 20, doc.y, { width: W - 32 });
                doc.moveDown(0.3);
            }
            doc.moveDown(0.15);
        }
    }

    // ── Correções desligadas pelo usuário ─────────────────────────────────────
    if (dados.skips && dados.skips.length) {
        ensure(50);
        doc.moveDown(0.5);
        doc.font('Helvetica-Bold').fontSize(10).fillColor(COR_ALERTA).text('Correções DESLIGADAS pelo usuário (não aplicadas)', M, doc.y);
        doc.font('Helvetica').fontSize(8).fillColor(COR_SUAVE).text('O erro correspondente pode permanecer no arquivo. Decisão do contribuinte.', M);
        doc.moveDown(0.2);
        for (const s of dados.skips) {
            ensure(16);
            const rot = LABEL_REGRA[s.regra_id] || s.regra_id;
            doc.font('Helvetica').fontSize(8.5).fillColor(COR_TEXTO)
                .text(`•  ${rot}${s.chave ? '  ·  ' + s.chave : ''}`, M + 6, doc.y, { width: W - 12 });
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

module.exports = { gerarRelatorioCorrecoes };
