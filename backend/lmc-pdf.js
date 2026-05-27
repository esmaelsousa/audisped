// Módulo de geração de PDF do LMC — Modelo AutoSystem
const PDFDocument = require('pdfkit');

function formatNum(v, decimals = 2) {
    if (v === null || v === undefined || isNaN(v)) return '0,00';
    return Number(v).toFixed(decimals).replace('.', ',').replace(/\B(?=(\d{3})+(?=,))/g, '.');
}

function gerarPaginaLMC(doc, dados, pageNum) {
    const { empresa, combustivel, data, tanques, bicos, estoque, entradas, vendas } = dados;
    const m = 30; // margem
    const w = doc.page.width - m * 2;
    const pageH = doc.page.height - m * 2 - 20; // espaço útil (descontando rodapé)
    const lineH = 16;

    // Calcular alturas proporcionais para preencher a página
    const cabecalhoH = 34;
    const produtoDataH = lineH;
    const estoqueAbertH = 16 + 28;
    const bicoHeaderH = lineH * 2;
    const bicoLinhaH = lineH;
    const totalBicosH = bicoHeaderH + Math.max(bicos.length, 1) * bicoLinhaH;
    const conciliacaoH = 36;
    const avisoH = 14;
    const fixedH = cabecalhoH + produtoDataH + estoqueAbertH + totalBicosH + conciliacaoH + avisoH;

    // Espaço restante dividido entre: vol recebido, valores/estoque, observações/fiscalização
    const remainH = pageH - fixedH;
    const recebidoH = Math.max(60, Math.floor(remainH * 0.30));
    const valoresH = Math.max(lineH * 5, Math.floor(remainH * 0.25));
    const obsH = Math.max(50, remainH - recebidoH - valoresH);

    let y = m;

    const borderColor = '#333333';
    const headerBg = '#e8e8e8';

    const drawRect = (x, ry, rw, rh, fill) => {
        if (fill) doc.rect(x, ry, rw, rh).fill(fill);
        doc.rect(x, ry, rw, rh).strokeColor(borderColor).lineWidth(0.5).stroke();
    };

    const txt = (str, x, ty, opts = {}) => {
        doc.fillColor(opts.color || '#333333')
           .fontSize(opts.size || 8)
           .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
           .text(String(str || ''), x, ty, { width: opts.width, align: opts.align || 'left', lineBreak: false, continued: false });
        // Resetar cursor para evitar auto page break
        doc.x = m;
        doc.y = ty;
    };

    // ═══════════════════════════════════════════════
    // CABEÇALHO
    // ═══════════════════════════════════════════════
    drawRect(m, y, w, cabecalhoH, headerBg);
    txt('LIVRO DE MOVIMENTAÇÃO DE COMBUSTÍVEIS (LMC)', m + 5, y + 5, { bold: true, size: 10 });
    txt(`Empresa: ${empresa.razao_social}   CNPJ: ${empresa.cnpj}   I.E.: ${empresa.ie}`, m + 5, y + 20, { size: 7.5 });
    txt(`Fl. nr. ${pageNum}`, m + w - 70, y + 5, { size: 9, bold: true, align: 'right', width: 65 });
    y += cabecalhoH;

    // ═══════════════════════════════════════════════
    // 1) PRODUTO  |  2) DATA
    // ═══════════════════════════════════════════════
    const halfW = w / 2;
    drawRect(m, y, halfW, produtoDataH);
    drawRect(m + halfW, y, halfW, produtoDataH);
    txt(`1) Produto: ${combustivel.nome}`, m + 4, y + 3, { bold: true, size: 8 });
    txt(`2) Data: ${data}`, m + halfW + 4, y + 3, { bold: true, size: 8 });
    y += produtoDataH;

    // ═══════════════════════════════════════════════
    // 3) ESTOQUE ABERTURA
    // ═══════════════════════════════════════════════
    drawRect(m, y, w, 16);
    txt('3) Estoque de Abertura (Medição Física no início do dia)', m + 4, y + 3, { size: 7 });
    y += 16;

    const tqW = (w - 130) / Math.max(tanques.length, 1);
    drawRect(m, y, w - 130, 28);
    drawRect(m + w - 130, y, 130, 28);

    tanques.forEach((tq, i) => {
        txt(`TQ) ${tq.num}`, m + 4 + i * tqW, y + 3, { size: 6.5 });
        txt(formatNum(tq.abertura, 3), m + 4 + i * tqW, y + 14, { size: 8, bold: true });
    });

    txt('3.1) Estoque Abertura', m + w - 128, y + 3, { size: 6.5 });
    txt(formatNum(estoque.abertura, 3), m + w - 128, y + 14, { size: 9, bold: true });
    y += 28;

    // ═══════════════════════════════════════════════
    // 4) VOLUME RECEBIDO
    // ═══════════════════════════════════════════════
    drawRect(m, y, w * 0.6, recebidoH);
    drawRect(m + w * 0.6, y, w * 0.4, recebidoH);

    txt('4) Volume Recebido no dia (em litros)', m + 4, y + 3, { size: 7 });
    let ey = y + 16;
    entradas.forEach(ent => {
        txt(`NF ${ent.num_doc} - ${formatNum(ent.volume, 3)} L`, m + 6, ey, { size: 6.5 });
        ey += 11;
    });

    txt('4.1) Nr. TQ. Descarga', m + w * 0.6 + 4, y + 3, { size: 6.5 });
    txt('4.2) Volume Recebido', m + w * 0.6 + 4, y + 16, { size: 6.5 });
    txt('4.3) Total Recebido', m + w * 0.6 + 4, y + recebidoH - 28, { size: 6.5 });
    txt(formatNum(estoque.entradas, 3), m + w - 60, y + recebidoH - 28, { size: 8, bold: true, align: 'right', width: 55 });
    txt('4.4) Vol. Disponível (3.1 + 4.3)', m + w * 0.6 + 4, y + recebidoH - 14, { size: 6.5 });
    txt(formatNum(estoque.disponivel, 3), m + w - 60, y + recebidoH - 14, { size: 8, bold: true, align: 'right', width: 55 });
    y += recebidoH;

    // ═══════════════════════════════════════════════
    // 5) VOLUME VENDIDO — BICOS
    // ═══════════════════════════════════════════════
    drawRect(m, y, w, lineH);
    txt('5) Volume Vendido no dia (em litros)', m + 4, y + 3, { size: 7 });
    y += lineH;

    const cols = [
        { label: '5.1) Tanque', cw: 60 },
        { label: '5.2) Bico', cw: 50 },
        { label: '5.3) + Fechamento', cw: 105 },
        { label: '5.4) - Abertura', cw: 105 },
        { label: '5.5) - Aferições', cw: 75 },
        { label: '5.6) = Vendas Bico', cw: w - 395 },
    ];
    let cx = m;
    drawRect(m, y, w, lineH, '#f0f0f0');
    cols.forEach(col => {
        txt(col.label, cx + 3, y + 3, { size: 6.5, bold: true });
        cx += col.cw;
    });
    y += lineH;

    bicos.forEach(bico => {
        drawRect(m, y, w, bicoLinhaH);
        cx = m;
        txt(bico.tanque, cx + 3, y + 3, { size: 7.5 }); cx += cols[0].cw;
        txt(bico.num, cx + 3, y + 3, { size: 7.5 }); cx += cols[1].cw;
        txt(formatNum(bico.enc_final, 3), cx + 3, y + 3, { size: 7.5 }); cx += cols[2].cw;
        txt(formatNum(bico.enc_inicial, 3), cx + 3, y + 3, { size: 7.5 }); cx += cols[3].cw;
        txt(formatNum(bico.aferição, 3), cx + 3, y + 3, { size: 7.5 }); cx += cols[4].cw;
        txt(formatNum(bico.vendas, 3), cx + 3, y + 3, { size: 7.5, bold: true });
        y += bicoLinhaH;
    });

    if (bicos.length === 0) {
        drawRect(m, y, w, bicoLinhaH);
        txt('Sem movimentação de bicos neste dia', m + 4, y + 3, { size: 7, color: '#999999' });
        y += bicoLinhaH;
    }

    // ═══════════════════════════════════════════════
    // VALORES R$ E ESTOQUE (lado a lado)
    // ═══════════════════════════════════════════════
    drawRect(m, y, halfW, valoresH);
    drawRect(m + halfW, y, halfW, valoresH);

    const valLH = Math.floor(valoresH / 5);
    let ly = y + 3;
    txt('10) Valor Vendas (R$)', m + 4, ly, { size: 6.5 }); ly += valLH;
    txt('Valor médio do preço por litro', m + 4, ly, { size: 6.5 }); ly += valLH;
    txt('10.1) Valor Vendas dia', m + 4, ly, { size: 6.5 });
    txt(vendas.valor_dia ? `R$ ${formatNum(vendas.valor_dia)}` : '', m + halfW - 80, ly, { size: 8, bold: true, align: 'right', width: 75 }); ly += valLH;
    txt('10.2) Valor Acumulado mês', m + 4, ly, { size: 6.5 });
    txt(vendas.valor_acumulado ? `R$ ${formatNum(vendas.valor_acumulado)}` : '', m + halfW - 80, ly, { size: 8, bold: true, align: 'right', width: 75 }); ly += valLH;
    txt('11) Venda litros no mês', m + 4, ly, { size: 6.5 });
    txt(formatNum(vendas.litros_acumulado, 3), m + halfW - 80, ly, { size: 8, bold: true, align: 'right', width: 75 });

    let ry = y + 3;
    txt('5.7) Vendas no dia (Página atual)', m + halfW + 4, ry, { size: 6.5 });
    txt(formatNum(estoque.saidas, 3), m + w - 60, ry, { size: 8, bold: true, align: 'right', width: 55 }); ry += valLH;
    txt('6) Estoque Escritural (4.4 - 5.7)', m + halfW + 4, ry, { size: 6.5 });
    txt(formatNum(estoque.escritural, 3), m + w - 60, ry, { size: 8, bold: true, align: 'right', width: 55 }); ry += valLH;
    txt('7) Estoque de Fechamento (9.1)', m + halfW + 4, ry, { size: 6.5 });
    txt(formatNum(estoque.fechamento, 3), m + w - 60, ry, { size: 8, bold: true, align: 'right', width: 55 }); ry += valLH;
    txt('8) - Perdas + Sobras (*)', m + halfW + 4, ry, { size: 6.5 });
    const perdaSobra = (estoque.ganho || 0) - (estoque.perda || 0);
    txt(formatNum(perdaSobra, 3), m + w - 60, ry, { size: 8, bold: true, align: 'right', width: 55 });
    y += valoresH;

    // ═══════════════════════════════════════════════
    // 13) OBSERVAÇÕES  |  12) FISCALIZAÇÃO
    // ═══════════════════════════════════════════════
    drawRect(m, y, halfW, obsH);
    drawRect(m + halfW, y, halfW, obsH);

    txt('13) Observações', m + 4, y + 3, { size: 7 });
    let oy = y + 16;
    bicos.forEach(bico => {
        if (bico.preco) {
            txt(`Bico ${bico.num} R$ ${formatNum(bico.preco, 3)}`, m + 6, oy, { size: 6.5 });
            oy += 10;
        }
    });

    txt('12) Destinado à Fiscalização', m + halfW + 4, y + 3, { size: 7 });
    txt('ANP', m + halfW + 6, y + 18, { size: 8, bold: true });
    txt('OUTROS ÓRGÃOS FISCAIS', m + halfW + 6, y + obsH - 18, { size: 7 });
    y += obsH;

    // ═══════════════════════════════════════════════
    // 9) CONCILIAÇÃO DOS ESTOQUES
    // ═══════════════════════════════════════════════
    drawRect(m, y, w, conciliacaoH);
    txt('Conciliação dos Estoques', m + 4, y + 3, { size: 7, bold: true });
    txt('9)', m + 4, y + 14, { size: 6.5 });
    txt('Fechamento', m + 4, y + 21, { size: 6.5 });
    txt('Físico', m + 4, y + 28, { size: 6 });

    const tqConcW = (w - 130) / Math.max(tanques.length, 1);
    tanques.forEach((tq, i) => {
        txt(`TQ) ${tq.num}`, m + 65 + i * tqConcW, y + 14, { size: 6.5 });
        txt(formatNum(tq.fechamento, 3), m + 65 + i * tqConcW, y + 23, { size: 7.5 });
    });
    txt('9.1) Total', m + w - 80, y + 14, { size: 6.5 });
    txt(formatNum(estoque.fechamento, 3), m + w - 80, y + 23, { size: 8, bold: true });
    y += conciliacaoH;

    // AVISO
    drawRect(m, y, w, avisoH);
    txt('(*) ATENÇÃO - SE O RESULTADO FOR NEGATIVO, PODE ESTAR HAVENDO VAZAMENTO PARA O MEIO AMBIENTE.', m + 4, y + 3, { size: 6, bold: true });
    y += avisoH;

    // RODAPÉ — desenhar diretamente sem doc.text() para evitar auto page break
    const footY = doc.page.height - 22;
    doc.fontSize(6).font('Helvetica').fillColor('#999999');
    // Usar widthOfString para posicionar manualmente
    const leftText = 'Audisped - audisped.com.br';
    const rightText = `${empresa.razao_social} - ${new Date().toLocaleDateString('pt-BR')} - Pag. ${pageNum}`;
    const rightW = doc.widthOfString(rightText);
    doc.text(leftText, m, footY, { lineBreak: false });
    doc.y = footY; // forçar Y de volta
    doc.text(rightText, m + w - rightW, footY, { lineBreak: false });
    doc.y = m; // travar cursor longe do final para impedir nova página
}

module.exports = { gerarPaginaLMC, formatNum };
