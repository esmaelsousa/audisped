// Módulo de geração de PDF do LMC — Modelo AutoSystem (idêntico)
const PDFDocument = require('pdfkit');

function formatNum(v, decimals = 2) {
    if (v === null || v === undefined || isNaN(v)) return '0,00';
    return Number(v).toFixed(decimals).replace('.', ',').replace(/\B(?=(\d{3})+(?=,))/g, '.');
}

function gerarPaginaLMC(doc, dados, pageNum) {
    const { empresa, combustivel, data, tanques, bicos, estoque, entradas, vendas } = dados;
    const m = 28;
    const w = doc.page.width - m * 2;
    const pH = doc.page.height;

    const borderColor = '#000000';
    const lw = 0.5;

    const line = (x1, y1, x2, y2) => {
        doc.moveTo(x1, y1).lineTo(x2, y2).strokeColor(borderColor).lineWidth(lw).stroke();
    };
    const rect = (x, y, rw, rh) => {
        doc.rect(x, y, rw, rh).strokeColor(borderColor).lineWidth(lw).stroke();
    };
    const t = (str, x, y, opts = {}) => {
        doc.fillColor(opts.color || '#000000')
           .fontSize(opts.size || 7.5)
           .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
           .text(String(str || ''), x, y, { width: opts.w, align: opts.align || 'left', lineBreak: false });
        doc.y = y;
    };
    const tR = (str, x, y, cw) => t(str, x, y, { size: 7.5, bold: true, w: cw, align: 'right' });

    // Calcular alturas
    const hCab = 28;
    const hProd = 14;
    const hAbert = 12 + 24;
    const hBicoLin = 14;
    const nBicos = Math.max(bicos.length, 1);
    const hBicos = 14 + 14 + nBicos * hBicoLin; // titulo + header + linhas
    const hValores = 14 * 5;
    const hConc = 32;
    const hAviso = 12;
    const hRodape = 14;
    const fixo = hCab + hProd + hAbert + hBicos + hValores + hConc + hAviso + hRodape;
    const sobra = pH - m * 2 - fixo;
    const hReceb = Math.max(50, Math.floor(sobra * 0.35));
    const hObs = Math.max(40, sobra - hReceb);

    let y = m;
    const rW = w * 0.4; // largura coluna direita
    const lW = w - rW;  // largura coluna esquerda

    // ══════════════════════════════════════════════════════════════════
    // CABEÇALHO
    // ══════════════════════════════════════════════════════════════════
    rect(m, y, w, hCab);
    t('LIVRO DE MOVIMENTAÇÃO DE COMBUSTÍVEIS (LMC)', m + 4, y + 3, { bold: true, size: 9 });
    t(`Empresa: ${empresa.razao_social}   CNPJ: ${empresa.cnpj}   I.E.: ${empresa.ie}`, m + 4, y + 15, { size: 7 });
    t(`Fl. nr. ${pageNum}`, m + w - 55, y + 3, { size: 8, bold: true, w: 50, align: 'right' });
    y += hCab;

    // ══════════════════════════════════════════════════════════════════
    // 1) PRODUTO  |  2) DATA
    // ══════════════════════════════════════════════════════════════════
    rect(m, y, lW, hProd);
    rect(m + lW, y, rW, hProd);
    t(`1) Produto: ${combustivel.nome}`, m + 4, y + 3, { bold: true, size: 7.5 });
    t(`2) Data: ${data}`, m + lW + 4, y + 3, { bold: true, size: 7.5 });
    y += hProd;

    // ══════════════════════════════════════════════════════════════════
    // 3) ESTOQUE ABERTURA
    // ══════════════════════════════════════════════════════════════════
    rect(m, y, w, 12);
    t('3) Estoque de Abertura (Medição Física no início do dia)', m + 4, y + 2, { size: 7 });
    y += 12;

    // Tanques
    const tqCols = Math.min(tanques.length, 6);
    const tqW = tqCols > 0 ? (w - 130) / tqCols : w - 130;
    rect(m, y, w - 130, 24);
    rect(m + w - 130, y, 130, 24);
    tanques.forEach((tq, i) => {
        if (i < 6) {
            t(`TQ) ${tq.num}`, m + 3 + i * tqW, y + 2, { size: 6.5 });
            t(formatNum(tq.abertura, 3), m + 3 + i * tqW, y + 12, { size: 7.5, bold: true });
        }
    });
    t('3.1) Estoque Abertura', m + w - 128, y + 2, { size: 6.5 });
    t(formatNum(estoque.abertura, 3), m + w - 128, y + 12, { size: 8, bold: true });
    y += 24;

    // ══════════════════════════════════════════════════════════════════
    // 4) VOLUME RECEBIDO
    // ══════════════════════════════════════════════════════════════════
    rect(m, y, lW, hReceb);
    rect(m + lW, y, rW, hReceb);

    t('4) Volume Recebido no dia (em litros)', m + 4, y + 2, { size: 7 });
    // NF-e no lado esquerdo
    let ey = y + 14;
    entradas.forEach(ent => {
        if (ey < y + hReceb - 10) {
            t(`NF ${ent.num_doc} — ${formatNum(ent.volume, 3)} L`, m + 6, ey, { size: 7 });
            ey += 11;
        }
    });

    // Lado direito
    t('4.1) Nr. TQ. Descarga', m + lW + 4, y + 2, { size: 6.5 });
    t('4.2) Volume Recebido', m + lW + 4, y + 14, { size: 6.5 });

    // Linha 4.3
    line(m + lW, y + hReceb - 28, m + w, y + hReceb - 28);
    t('4.3) Total Recebido', m + lW + 4, y + hReceb - 26, { size: 6.5 });
    tR(formatNum(estoque.entradas, 3), m + lW, y + hReceb - 26, rW - 6);

    // Linha 4.4
    line(m + lW, y + hReceb - 14, m + w, y + hReceb - 14);
    t('4.4) Vol. Disponível', m + lW + 4, y + hReceb - 12, { size: 6.5 });
    t('(3.1 + 4.3)', m + lW + 4 + 80, y + hReceb - 12, { size: 5.5 });
    tR(formatNum(estoque.disponivel, 3), m + lW, y + hReceb - 12, rW - 6);
    y += hReceb;

    // ══════════════════════════════════════════════════════════════════
    // 5) VOLUME VENDIDO — BICOS
    // ══════════════════════════════════════════════════════════════════
    rect(m, y, lW, 14);
    rect(m + lW, y, rW, 14);
    t('5) Volume Vendido no dia (em litro)', m + 4, y + 3, { size: 7 });
    y += 14;

    // Header bicos
    const cw1 = 55, cw2 = 42, cw3 = 95, cw4 = 12; // espaço restante para 5.4, 5.5, 5.6
    const cwRest = lW - cw1 - cw2 - cw3;
    rect(m, y, cw1, 14); rect(m + cw1, y, cw2, 14); rect(m + cw1 + cw2, y, cw3, 14);
    rect(m + lW, y, rW, 14);
    t('5.1) Tanque', m + 2, y + 3, { size: 6.5 });
    t('5.2) Bico', m + cw1 + 2, y + 3, { size: 6.5 });
    t('5.3) + Fechamento', m + cw1 + cw2 + 2, y + 3, { size: 6.5 });
    t('5.4) - Abertura', m + lW + 2, y + 3, { size: 6.5 });
    t('5.5) - Aferições', m + lW + rW * 0.45, y + 3, { size: 6.5 });
    t('5.6) = Vendas Bico', m + lW + rW * 0.75, y + 3, { size: 6.5 });
    y += 14;

    // Linhas bicos
    bicos.forEach(bico => {
        rect(m, y, cw1, hBicoLin); rect(m + cw1, y, cw2, hBicoLin); rect(m + cw1 + cw2, y, cw3, hBicoLin);
        rect(m + lW, y, rW, hBicoLin);
        t(bico.tanque, m + 2, y + 3, { size: 7.5 });
        t(bico.num, m + cw1 + 2, y + 3, { size: 7.5 });
        t(formatNum(bico.enc_final, 3), m + cw1 + cw2 + 2, y + 3, { size: 7 });
        t(formatNum(bico.enc_inicial, 3), m + lW + 2, y + 3, { size: 7 });
        t(formatNum(bico.aferição, 3), m + lW + rW * 0.45, y + 3, { size: 7 });
        tR(formatNum(bico.vendas, 3), m + lW + rW * 0.65, y + 3, rW * 0.3);
        y += hBicoLin;
    });
    if (bicos.length === 0) {
        rect(m, y, lW, hBicoLin); rect(m + lW, y, rW, hBicoLin);
        y += hBicoLin;
    }

    // ══════════════════════════════════════════════════════════════════
    // 10) + 5.7/6/7/8 (lado a lado, 5 linhas)
    // ══════════════════════════════════════════════════════════════════
    const vLH = 14;
    for (let i = 0; i < 5; i++) {
        rect(m, y + i * vLH, lW, vLH);
        rect(m + lW, y + i * vLH, rW, vLH);
    }

    // Lado esquerdo
    t('10) Valor Vendas (R$)', m + 4, y + 3, { size: 6.5 });
    tR('', m, y + 3, lW - 6);

    t('Valor médio do preço por litro', m + 4, y + vLH + 3, { size: 6.5 });

    t('10.1) Valor das Vendas do dia (Página atual) (5.7 x Preço Bomba)', m + 4, y + vLH * 2 + 3, { size: 6 });
    tR(vendas.valor_dia ? formatNum(vendas.valor_dia) : '', m, y + vLH * 2 + 3, lW - 6);

    t('10.2) Valor Acumulado no mês (Todas Páginas)', m + 4, y + vLH * 3 + 3, { size: 6 });
    tR(vendas.valor_acumulado ? formatNum(vendas.valor_acumulado) : '', m, y + vLH * 3 + 3, lW - 6);

    t('11) Para uso do Revendedor (Venda em litros no mês) (Todas', m + 4, y + vLH * 4 + 1, { size: 6 });
    t('Páginas):', m + 4, y + vLH * 4 + 8, { size: 6 });
    tR(formatNum(vendas.litros_acumulado, 3), m, y + vLH * 4 + 3, lW - 6);

    // Lado direito
    t('5.7) Vendas no dia (Página atual)', m + lW + 4, y + 3, { size: 6.5 });
    tR(formatNum(estoque.saidas, 3), m + lW, y + 3, rW - 6);

    t('6) Estoque Escritural (Todas Páginas) (4.4 - 5.7)', m + lW + 4, y + vLH + 3, { size: 6 });
    tR(formatNum(estoque.escritural, 3), m + lW, y + vLH + 3, rW - 6);

    t('7) Estoque de Fechamento (9.1) (Todas Páginas)', m + lW + 4, y + vLH * 2 + 3, { size: 6 });
    tR(formatNum(estoque.fechamento, 3), m + lW, y + vLH * 2 + 3, rW - 6);

    t('8) - Perdas + Sobras (*) (Todas Páginas)', m + lW + 4, y + vLH * 3 + 3, { size: 6 });
    const perdaSobra = (estoque.ganho || 0) - (estoque.perda || 0);
    tR(formatNum(perdaSobra, 3), m + lW, y + vLH * 3 + 3, rW - 6);

    y += vLH * 5;

    // ══════════════════════════════════════════════════════════════════
    // 13) OBSERVAÇÕES  |  12) FISCALIZAÇÃO
    // ══════════════════════════════════════════════════════════════════
    rect(m, y, lW, hObs);
    rect(m + lW, y, rW, hObs);

    t('13) Observações', m + 4, y + 3, { size: 7 });
    let oy = y + 16;
    bicos.forEach(bico => {
        if (bico.preco && oy < y + hObs - 10) {
            t(`Bico ${bico.num} R$ ${formatNum(bico.preco, 3)}`, m + 6, oy, { size: 7 });
            oy += 10;
        }
    });

    t('12) Destinado à Fiscalização', m + lW + 4, y + 3, { size: 7 });
    t('ANP', m + lW + 6, y + 18, { size: 8, bold: true });
    t('OUTROS ÓRGÃOS FISCAIS', m + lW + 6, y + hObs - 20, { size: 7 });
    y += hObs;

    // ══════════════════════════════════════════════════════════════════
    // 9) CONCILIAÇÃO DOS ESTOQUES
    // ══════════════════════════════════════════════════════════════════
    rect(m, y, w, hConc);
    t('Conciliação dos Estoques', m + 4, y + 2, { size: 7, bold: true });
    t('9)', m + 4, y + 12, { size: 6.5 });
    t('Fechamento', m + 4, y + 18, { size: 6.5 });
    t('Físico', m + 4, y + 24, { size: 6 });

    const tqCW = (w - 130) / Math.max(tanques.length, 1);
    tanques.forEach((tq, i) => {
        if (i < 6) {
            t(`TQ) ${tq.num}`, m + 60 + i * tqCW, y + 12, { size: 6.5 });
            t(formatNum(tq.fechamento, 3), m + 60 + i * tqCW, y + 20, { size: 7.5 });
        }
    });
    line(m + w - 80, y, m + w - 80, y + hConc);
    t('9.1) Total', m + w - 78, y + 12, { size: 6.5 });
    t(formatNum(estoque.fechamento, 3), m + w - 78, y + 20, { size: 8, bold: true });
    y += hConc;

    // AVISO
    rect(m, y, w, hAviso);
    t('(*) ATENÇÃO - SE O RESULTADO FOR NEGATIVO, PODE ESTAR HAVENDO VAZAMENTO PARA O MEIO AMBIENTE.', m + 4, y + 3, { size: 5.5, bold: true });
    y += hAviso;

    // RODAPÉ
    const footY = pH - m - 2;
    doc.fontSize(5.5).font('Helvetica').fillColor('#666666');
    doc.text('Audisped - audisped.com.br', m, footY, { lineBreak: false });
    doc.y = footY;
    const rTxt = `${empresa.razao_social} - ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR')} - Pág. ${pageNum}`;
    const rTxtW = doc.widthOfString(rTxt);
    doc.text(rTxt, m + w - rTxtW, footY, { lineBreak: false });
    doc.y = m;
}

module.exports = { gerarPaginaLMC, formatNum };
