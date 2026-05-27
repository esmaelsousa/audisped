// Módulo de geração de PDF do LMC — Modelo AutoSystem
const PDFDocument = require('pdfkit');

function formatNum(v, decimals = 2) {
    if (v === null || v === undefined || isNaN(v)) return '0,00';
    return Number(v).toFixed(decimals).replace('.', ',').replace(/\B(?=(\d{3})+(?=,))/g, '.');
}

function gerarPaginaLMC(doc, dados, pageNum) {
    const { empresa, combustivel, data, tanques, bicos, estoque, entradas, vendas } = dados;
    const m = 40; // margem
    const w = doc.page.width - m * 2;
    const lineH = 14;
    let y = m;

    // Cores
    const borderColor = '#333333';
    const headerBg = '#f0f0f0';
    const labelColor = '#333333';
    const valueColor = '#000000';

    const drawLine = (x1, y1, x2, y2) => {
        doc.moveTo(x1, y1).lineTo(x2, y2).strokeColor(borderColor).lineWidth(0.5).stroke();
    };

    const drawRect = (x, y, w, h, fill) => {
        if (fill) doc.rect(x, y, w, h).fill(fill);
        doc.rect(x, y, w, h).strokeColor(borderColor).lineWidth(0.5).stroke();
    };

    const text = (str, x, y, opts = {}) => {
        doc.fillColor(opts.color || labelColor)
           .fontSize(opts.size || 7.5)
           .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
           .text(str, x, y, { width: opts.width, align: opts.align || 'left', lineBreak: false, ...opts });
    };

    // ═══════════════════════════════════════════════
    // CABEÇALHO
    // ═══════════════════════════════════════════════
    drawRect(m, y, w, 30, headerBg);
    text('LIVRO DE MOVIMENTAÇÃO DE COMBUSTÍVEIS (LMC)', m + 5, y + 4, { bold: true, size: 9 });
    text(`Empresa: ${empresa.razao_social}   CNPJ: ${empresa.cnpj}   I.E.: ${empresa.ie}`, m + 5, y + 16, { size: 7 });
    text(`Fl. nr. ${pageNum}`, m + w - 60, y + 4, { size: 8, bold: true, align: 'right', width: 55 });
    y += 32;

    // ═══════════════════════════════════════════════
    // 1) PRODUTO  |  2) DATA
    // ═══════════════════════════════════════════════
    const halfW = w / 2;
    drawRect(m, y, halfW, lineH);
    drawRect(m + halfW, y, halfW, lineH);
    text(`1) Produto: ${combustivel.nome}`, m + 3, y + 3, { bold: true, size: 7 });
    text(`2) Data: ${data}`, m + halfW + 3, y + 3, { bold: true, size: 7 });
    y += lineH;

    // ═══════════════════════════════════════════════
    // 3) ESTOQUE ABERTURA  |  3.1) Total
    // ═══════════════════════════════════════════════
    drawRect(m, y, w, lineH);
    text('3) Estoque de Abertura (Medição Física no início do dia)', m + 3, y + 3, { size: 6.5 });
    y += lineH;

    // Tanques de abertura
    const tqH = 24;
    const tqW = (w - 120) / Math.max(tanques.length, 1);
    drawRect(m, y, w - 120, tqH);
    drawRect(m + w - 120, y, 120, tqH);

    tanques.forEach((tq, i) => {
        text(`TQ) ${tq.num}`, m + 3 + i * tqW, y + 3, { size: 6 });
        text(formatNum(tq.abertura, 3), m + 3 + i * tqW, y + 13, { size: 7, bold: true });
    });

    text('3.1) Estoque Abertura', m + w - 118, y + 3, { size: 6 });
    text(formatNum(estoque.abertura, 3), m + w - 118, y + 13, { size: 8, bold: true });
    y += tqH;

    // ═══════════════════════════════════════════════
    // 4) VOLUME RECEBIDO
    // ═══════════════════════════════════════════════
    const recH = Math.max(50, entradas.length * 12 + 20);
    drawRect(m, y, w * 0.6, recH);
    drawRect(m + w * 0.6, y, w * 0.4, recH);

    text('4) Volume Recebido no dia (em litros)', m + 3, y + 3, { size: 6.5 });
    let ey = y + 14;
    entradas.forEach(ent => {
        text(`NF ${ent.num_doc} - ${formatNum(ent.volume, 3)} L`, m + 5, ey, { size: 6 });
        ey += 10;
    });

    text('4.1) Nr. TQ. Descarga', m + w * 0.6 + 3, y + 3, { size: 6 });
    text('4.2) Volume Recebido', m + w * 0.6 + 3, y + 13, { size: 6 });
    text('4.3) Total Recebido', m + w * 0.6 + 3, y + 23, { size: 6 });
    text(formatNum(estoque.entradas, 3), m + w - 55, y + 23, { size: 7, bold: true, align: 'right', width: 50 });
    text('4.4) Vol. Disponível (3.1 + 4.3)', m + w * 0.6 + 3, y + 35, { size: 6 });
    text(formatNum(estoque.disponivel, 3), m + w - 55, y + 35, { size: 7, bold: true, align: 'right', width: 50 });
    y += recH;

    // ═══════════════════════════════════════════════
    // 5) VOLUME VENDIDO — BICOS
    // ═══════════════════════════════════════════════
    const bicoH = lineH;
    drawRect(m, y, w, lineH);
    text('5) Volume Vendido no dia (em litros)', m + 3, y + 3, { size: 6.5 });
    y += lineH;

    // Cabeçalho bicos
    const cols = [
        { label: '5.1) Tanque', w: 55 },
        { label: '5.2) Bico', w: 45 },
        { label: '5.3) + Fechamento', w: 100 },
        { label: '5.4) - Abertura', w: 100 },
        { label: '5.5) - Aferições', w: 70 },
        { label: '5.6) = Vendas Bico', w: w - 370 },
    ];
    let cx = m;
    drawRect(m, y, w, lineH, '#f5f5f5');
    cols.forEach(col => {
        text(col.label, cx + 2, y + 3, { size: 6, bold: true });
        cx += col.w;
    });
    y += lineH;

    // Linhas de bicos
    bicos.forEach(bico => {
        drawRect(m, y, w, lineH);
        cx = m;
        text(bico.tanque, cx + 2, y + 3, { size: 7 }); cx += cols[0].w;
        text(bico.num, cx + 2, y + 3, { size: 7 }); cx += cols[1].w;
        text(formatNum(bico.enc_final, 3), cx + 2, y + 3, { size: 7 }); cx += cols[2].w;
        text(formatNum(bico.enc_inicial, 3), cx + 2, y + 3, { size: 7 }); cx += cols[3].w;
        text(formatNum(bico.aferição, 3), cx + 2, y + 3, { size: 7 }); cx += cols[4].w;
        text(formatNum(bico.vendas, 3), cx + 2, y + 3, { size: 7, bold: true });
        y += lineH;
    });

    // ═══════════════════════════════════════════════
    // VALORES E ESTOQUE (lado a lado)
    // ═══════════════════════════════════════════════
    const blkH = lineH * 5;
    drawRect(m, y, halfW, blkH);
    drawRect(m + halfW, y, halfW, blkH);

    // Lado esquerdo: Valores R$
    let ly = y + 3;
    text('10) Valor Vendas (R$)', m + 3, ly, { size: 6 }); ly += lineH;
    text('Valor médio do preço por litro', m + 3, ly, { size: 6 }); ly += lineH;
    text('10.1) Valor Vendas dia', m + 3, ly, { size: 6 });
    text(vendas.valor_dia ? `R$ ${formatNum(vendas.valor_dia)}` : '', m + halfW - 75, ly, { size: 7, bold: true, align: 'right', width: 70 }); ly += lineH;
    text('10.2) Valor Acumulado mês', m + 3, ly, { size: 6 });
    text(vendas.valor_acumulado ? `R$ ${formatNum(vendas.valor_acumulado)}` : '', m + halfW - 75, ly, { size: 7, bold: true, align: 'right', width: 70 }); ly += lineH;
    text('11) Venda litros no mês', m + 3, ly, { size: 6 });
    text(formatNum(vendas.litros_acumulado, 3), m + halfW - 75, ly, { size: 7, bold: true, align: 'right', width: 70 });

    // Lado direito: Estoque
    let ry = y + 3;
    text('5.7) Vendas no dia (Página atual)', m + halfW + 3, ry, { size: 6 });
    text(formatNum(estoque.saidas, 3), m + w - 55, ry, { size: 7, bold: true, align: 'right', width: 50 }); ry += lineH;
    text('6) Estoque Escritural (4.4 - 5.7)', m + halfW + 3, ry, { size: 6 });
    text(formatNum(estoque.escritural, 3), m + w - 55, ry, { size: 7, bold: true, align: 'right', width: 50 }); ry += lineH;
    text('7) Estoque de Fechamento (9.1)', m + halfW + 3, ry, { size: 6 });
    text(formatNum(estoque.fechamento, 3), m + w - 55, ry, { size: 7, bold: true, align: 'right', width: 50 }); ry += lineH;
    text('8) - Perdas + Sobras (*)', m + halfW + 3, ry, { size: 6 });
    const perdaSobra = (estoque.ganho || 0) - (estoque.perda || 0);
    text(formatNum(perdaSobra, 3), m + w - 55, ry, { size: 7, bold: true, align: 'right', width: 50 });
    y += blkH;

    // ═══════════════════════════════════════════════
    // 13) OBSERVAÇÕES  |  12) FISCALIZAÇÃO
    // ═══════════════════════════════════════════════
    const obsH = 60;
    drawRect(m, y, halfW, obsH);
    drawRect(m + halfW, y, halfW, obsH);

    text('13) Observações', m + 3, y + 3, { size: 6.5 });
    // Preços por bico
    let oy = y + 14;
    bicos.forEach(bico => {
        if (bico.preco) {
            text(`Bico ${bico.num} R$ ${formatNum(bico.preco, 3)}`, m + 5, oy, { size: 6 });
            oy += 9;
        }
    });

    text('12) Destinado à Fiscalização', m + halfW + 3, y + 3, { size: 6.5 });
    text('ANP', m + halfW + 5, y + 16, { size: 7, bold: true });
    text('OUTROS ÓRGÃOS FISCAIS', m + halfW + 5, y + obsH - 15, { size: 6 });
    y += obsH;

    // ═══════════════════════════════════════════════
    // 9) CONCILIAÇÃO DOS ESTOQUES
    // ═══════════════════════════════════════════════
    const concH = 30;
    drawRect(m, y, w, concH);
    text('Conciliação dos Estoques', m + 3, y + 2, { size: 6.5, bold: true });
    text('9)', m + 3, y + 12, { size: 6 });
    text('Fechamento', m + 3, y + 19, { size: 6 });
    text('Físico', m + 3, y + 25, { size: 5.5 });

    const tqConcW = (w - 120) / Math.max(tanques.length, 1);
    tanques.forEach((tq, i) => {
        text(`TQ) ${tq.num}`, m + 60 + i * tqConcW, y + 12, { size: 6 });
        text(formatNum(tq.fechamento, 3), m + 60 + i * tqConcW, y + 21, { size: 7 });
    });
    text('9.1) Total', m + w - 75, y + 12, { size: 6 });
    text(formatNum(estoque.fechamento, 3), m + w - 75, y + 21, { size: 7, bold: true });
    y += concH;

    // AVISO
    drawRect(m, y, w, 12);
    text('(*) ATENÇÃO - SE O RESULTADO FOR NEGATIVO, PODE ESTAR HAVENDO VAZAMENTO PARA O MEIO AMBIENTE.', m + 3, y + 3, { size: 5.5, bold: true });
    y += 12;

    // RODAPÉ
    doc.fontSize(6).fillColor('#888888')
       .text('Audisped - audisped.com.br', m, doc.page.height - 25, { width: w / 2, align: 'left' })
       .text(`${empresa.razao_social} - ${new Date().toLocaleDateString('pt-BR')} - Pág. ${pageNum}`, m + w / 2, doc.page.height - 25, { width: w / 2, align: 'right' });
}

module.exports = { gerarPaginaLMC, formatNum };
