// COMB-1300/1310/1320 — Conteúdo do LMC (Bloco 1). Cobre o que o usuário pediu: dia com
// estoque NEGATIVO, coerência aritmética (FECH = ESCR − PERDA + GANHO etc.), fórmula do bico
// (VOL_VENDAS = FECHA − ABERT − AFERI) e CAP_TANQUE obrigatório (2026).
// Posições confirmadas em arquivo real:
//  1300: f2=COD_ITEM f3=DT f4=ABERT f5=ENTR f6=DISP f7=SAIDAS f8=ESCR f9=PERDA f10=GANHO f11=FECH
//  1310: f2=NUM_TANQUE f3=ABERT f4=ENTR f5=DISP f6=SAIDAS f7=ESCR f8=PERDA f9=GANHO f10=FECH f11=CAP(2026)
//  1320: f2=NUM_BICO ... f8=VAL_FECHA f9=VAL_ABERT f10=VOL_AFERI f11=VOL_VENDAS
const num = (v) => { let s = String(v == null ? '' : v).trim(); if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); return parseFloat(s) || 0; };
const TOL = 0.01;

module.exports = {
    id: 'COMB-LMC',
    bloco: '1',
    registro: '1300/1310/1320',
    titulo: 'Inconsistência no LMC (Bloco 1)',
    severidade: 'ADV',
    classeCorrecao: 'manual',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP/LMC, acerte a movimentação do combustível: estoque não pode ficar negativo e as contas do dia devem fechar (disponível = abertura + entradas; escritural = disponível − saídas; físico = escritural − perda + ganho).',
    detectar(model) {
        const erros = [];
        const ym = model.periodoYM;

        // ---- 1300 (por produto/dia) ----
        for (const l of (model.porReg.get('1300') || [])) {
            const f = l.f; if (f.length <= 11) continue;
            const ab = num(f[4]), ent = num(f[5]), disp = num(f[6]), sai = num(f[7]), escr = num(f[8]), perda = num(f[9]), ganho = num(f[10]), fech = num(f[11]);
            const cod = String(f[2] || '').trim(), dt = f[3] || '';
            // estoque/volume negativo (o "dia negativo")
            for (const [nome, val] of [['ESTQ_ABERT', ab], ['VOL_DISP', disp], ['ESTQ_ESCR', escr], ['FECH_FISICO', fech]]) {
                if (val < -0.001) erros.push({ bloco: '1', registro: '1300', linha: l.n, campo: nome, severidade: 'ADV', valorAtual: String(val), detalhe: `${nome} negativo (${val}) no produto ${cod}, dia ${dt}.` });
            }
            // coerência aritmética
            if (Math.abs(disp - (ab + ent)) > TOL) erros.push({ bloco: '1', registro: '1300', linha: l.n, campo: 'VOL_DISP', severidade: 'BLOQ', valorAtual: String(disp), valorSugerido: (ab + ent).toFixed(3), detalhe: `VOL_DISP (${disp}) ≠ ESTQ_ABERT + VOL_ENTR (${(ab + ent).toFixed(3)}) — produto ${cod}, dia ${dt}.` });
            else if (Math.abs(escr - (disp - sai)) > TOL) erros.push({ bloco: '1', registro: '1300', linha: l.n, campo: 'ESTQ_ESCR', severidade: 'BLOQ', valorAtual: String(escr), valorSugerido: (disp - sai).toFixed(3), detalhe: `ESTQ_ESCR (${escr}) ≠ VOL_DISP − VOL_SAIDAS (${(disp - sai).toFixed(3)}) — produto ${cod}, dia ${dt}.` });
            else if (Math.abs(fech - (escr - perda + ganho)) > TOL) erros.push({ bloco: '1', registro: '1300', linha: l.n, campo: 'FECH_FISICO', severidade: 'BLOQ', jaCorrigidoNoExport: true, valorAtual: String(fech), valorSugerido: (escr - perda + ganho).toFixed(3), detalhe: `FECH_FISICO (${fech}) ≠ ESTQ_ESCR − PERDA + GANHO (${(escr - perda + ganho).toFixed(3)}) — produto ${cod}, dia ${dt}.` });
        }

        // ---- 1310 (por tanque) ----
        for (const l of (model.porReg.get('1310') || [])) {
            const f = l.f; if (f.length <= 10) continue;
            const ab = num(f[3]), ent = num(f[4]), disp = num(f[5]), sai = num(f[6]), escr = num(f[7]), perda = num(f[8]), ganho = num(f[9]), fech = num(f[10]);
            const tq = String(f[2] || '').trim();
            for (const [nome, val] of [['ESTQ_ABERT', ab], ['VOL_DISP', disp], ['ESTQ_ESCR', escr], ['FECH_FISICO', fech]]) {
                if (val < -0.001) erros.push({ bloco: '1', registro: '1310', linha: l.n, campo: nome, severidade: 'ADV', valorAtual: String(val), detalhe: `${nome} negativo (${val}) no tanque ${tq}.` });
            }
            if (Math.abs(disp - (ab + ent)) > TOL) erros.push({ bloco: '1', registro: '1310', linha: l.n, campo: 'VOL_DISP', severidade: 'BLOQ', valorAtual: String(disp), valorSugerido: (ab + ent).toFixed(3), detalhe: `VOL_DISP (${disp}) ≠ ABERT + ENTR (${(ab + ent).toFixed(3)}) — tanque ${tq}.` });
            else if (Math.abs(escr - (disp - sai)) > TOL) erros.push({ bloco: '1', registro: '1310', linha: l.n, campo: 'ESTQ_ESCR', severidade: 'BLOQ', valorAtual: String(escr), valorSugerido: (disp - sai).toFixed(3), detalhe: `ESTQ_ESCR (${escr}) ≠ DISP − SAIDAS (${(disp - sai).toFixed(3)}) — tanque ${tq}.` });
            else if (Math.abs(fech - (escr - perda + ganho)) > TOL) erros.push({ bloco: '1', registro: '1310', linha: l.n, campo: 'FECH_FISICO', severidade: 'BLOQ', jaCorrigidoNoExport: true, valorAtual: String(fech), valorSugerido: (escr - perda + ganho).toFixed(3), detalhe: `FECH_FISICO (${fech}) ≠ ESCR − PERDA + GANHO (${(escr - perda + ganho).toFixed(3)}) — tanque ${tq}.` });
            // CAP_TANQUE obrigatório a partir de 2026 (leiaute 020)
            if (ym && ym >= '202601') {
                const cap = (f.length >= 13) ? String(f[11] || '').trim() : '';
                if (!cap || num(cap) <= 0) erros.push({ bloco: '1', registro: '1310', linha: l.n, campo: 'CAP_TANQUE', severidade: 'BLOQ', jaCorrigidoNoExport: true, valorAtual: cap || '(ausente)', detalhe: `CAP_TANQUE obrigatório a partir de 01/2026 ausente no tanque ${tq}.` });
            }
        }

        // ---- 1320 (bico) ----
        for (const l of (model.porReg.get('1320') || [])) {
            const f = l.f; if (f.length <= 11) continue;
            const fecha = num(f[8]), abert = num(f[9]), aferi = num(f[10]), vendas = num(f[11]);
            const bico = String(f[2] || '').trim();
            if (fecha < abert) continue; // virada de contador (tratada com 2 registros) — não acusa
            const esperado = fecha - abert - aferi;
            if (esperado < 0) continue; // aferição ≥ delta do encerrante → vendas=0 é correto (arredondamento)
            if (Math.abs(vendas - esperado) > TOL) erros.push({ bloco: '1', registro: '1320', linha: l.n, campo: 'VOL_VENDAS', severidade: 'BLOQ', valorAtual: String(vendas), valorSugerido: esperado.toFixed(3), detalhe: `VOL_VENDAS (${vendas}) ≠ VAL_FECHA − VAL_ABERT − VOL_AFERI (${esperado.toFixed(3)}) — bico ${bico}.` });
        }
        return erros;
    },
};
