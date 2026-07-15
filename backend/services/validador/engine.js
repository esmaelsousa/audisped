// Validador SPED — engine PURO. Roda todas as regras do registry sobre o modelo e
// agrega erros + cobertura por bloco. Sem IO. Determinístico e auditável.
const regras = require('./rules');
const { chaveNatural, ordinalH005 } = require('./correcoes');

function validar(model) {
    const erros = [];
    let regrasExecutadas = 0;
    for (const regra of regras) {
        regrasExecutadas++;
        let achados = [];
        try { achados = regra.detectar(model) || []; }
        catch (e) {
            erros.push({ regra_id: regra.id, bloco: regra.bloco || '?', severidade: 'ADV', titulo: `(falha interna na regra ${regra.id})`, detalhe: e.message });
            continue;
        }
        for (const a of achados) {
            erros.push({
                regra_id: regra.id,
                bloco: a.bloco || regra.bloco || '?',
                registro: a.registro || regra.registro || '',
                severidade: a.severidade || regra.severidade || 'ADV',
                classeCorrecao: a.classeCorrecao || regra.classeCorrecao || 'manual',
                jaCorrigidoNoExport: (a.jaCorrigidoNoExport ?? !!regra.jaCorrigidoNoExport),
                refCatalogo: (regra.refCatalogo || null),
                titulo: regra.titulo,
                linha: (a.linha ?? null),
                campo: a.campo || '',
                campoIdx: (a.campoIdx ?? null),   // índice do campo no pipe (p/ correção)
                permiteVazio: (a.permiteVazio ?? false), // correção pode salvar valor vazio (ex.: apagar COD_BARRA)
                valorAtual: (a.valorAtual ?? ''),
                valorSugerido: a.valorSugerido,
                ncm: (a.ncm ?? null),             // contexto opcional (ex.: CEST usa p/ sugerir por NCM)
                detalhe: a.detalhe || '',
                instrucaoERP: (typeof regra.instrucaoERP === 'function' ? regra.instrucaoERP(a) : (regra.instrucaoERP || '')),
            });
        }
    }
    // Cobertura por bloco (o "X"): todos os blocos presentes + contagem de erros.
    const porBloco = {};
    for (const b of [...model.blocos].sort()) porBloco[b] = { presente: true, erros: 0, bloqueantes: 0 };
    for (const e of erros) {
        if (!porBloco[e.bloco]) porBloco[e.bloco] = { presente: false, erros: 0, bloqueantes: 0 };
        porBloco[e.bloco].erros++;
        if (e.severidade === 'BLOQ') porBloco[e.bloco].bloqueantes++;
    }
    const bloqueantes = erros.filter(e => e.severidade === 'BLOQ').length;

    // Pós-processo: chave natural por linha (p/ casar a correção no export, robusto a nº de linha).
    // 1 passada sobre o modelo, rastreando a chave do C100 corrente (p/ filhos C170).
    const chavePorLinha = new Map();
    let curC100 = '';
    const h005Cont = new Map();
    for (const l of model.linhas) {
        if (l.reg === 'C100') curC100 = String(l.f[9] || '').replace(/\D/g, '');
        let kn = chaveNatural(l.reg, l.f, curC100);
        if (l.reg === 'H005' && kn != null) kn = ordinalH005(kn, h005Cont);
        chavePorLinha.set(l.n, kn);
    }
    for (const e of erros) {
        e.chaveNatural = (e.linha != null) ? (chavePorLinha.get(e.linha) ?? null) : null;
        // Corrigível no sistema = sabemos onde (chaveNatural) e qual campo (campoIdx).
        e.corrigivel = !!(e.chaveNatural != null && e.chaveNatural !== '' && e.campoIdx != null); // [F4] chave vazia não é corrigível
    }

    return {
        resumo: {
            total: erros.length, bloqueantes, advertencias: erros.length - bloqueantes,
            regrasExecutadas, blocosPresentes: [...model.blocos].sort(),
        },
        porBloco, erros,
    };
}

module.exports = { validar };
