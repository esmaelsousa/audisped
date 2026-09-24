// DOC-C170-CFOP-01 — CFOP do C170 (campo 11) inválido.
// PVA: "CFOP inválido. Utilizar código da Tabela de Código Fiscal de Operação e Prestação - CFOP."
//
// Três defeitos distintos, com mensagens e correções diferentes:
//
//  1. FORMATO — não são 4 dígitos começando em 1/2/3/5/6/7. Caso real (posto de exemplo, arq 388):
//     importação legada off-by-one gravou '0061' (o CST escrito no campo CFOP) em
//     documentos_itens_c170, e o export reaplicava por cima do .txt correto. Tem sugestão própria:
//     o CFOP verdadeiro costuma estar no COD_NAT (campo 12).
//
//  2. NÃO EXISTE na tabela oficial — passa no formato mas o código não existe. É o caso do CFOP
//     1929: 4 dígitos, começa em 1, e mesmo assim não existe. Nasce do flip ingênuo de 5929
//     (`sincronizarNotasInjetadas` vira o 1º dígito da CFOP de saída sem mapear) e gerou C190
//     órfão no POSTO PREÇO BOM. Até 24/09/2026 passava batido: a `cad_cfops` tinha 8 linhas feitas
//     à mão, então a regra só conseguia validar formato.
//
//  3. CABEÇALHO DE GRUPO — códigos como 1.650 ("ENTRADAS DE COMBUSTÍVEIS…") existem na tabela mas
//     são títulos de seção, não operações. Medido na frota: 2 ocorrências reais.
//
// Degradação segura: sem `model.dominio.cfopSet` (tabela ausente) só a checagem de FORMATO roda —
// nunca acusa "não existe" sem ter contra o que comparar.
// O export já corrige o caso 1 (guard anti-off-by-one confia no .txt) → jaCorrigidoNoExport=true.
// Posições C170: f[10]=CST_ICMS, f[11]=CFOP, f[12]=COD_NAT.
const CFOP_OK = (v) => /^[123567]\d{3}$/.test(String(v || '').trim());

module.exports = {
    id: 'DOC-C170-CFOP-01',
    bloco: 'C',
    registro: 'C170',
    titulo: 'CFOP inválido no item (C170, campo 11)',
    severidade: 'BLOQ',
    classeCorrecao: 'estrutural-seguro',
    jaCorrigidoNoExport: true,
    instrucaoERP: 'No ERP, o CFOP do item (C170) deve ser um código existente na Tabela de CFOP, com 4 dígitos começando em 1/2/3 (entrada) ou 5/6/7 (saída). Valores como "0061" são um CST gravado no campo errado; códigos como "1929" não existem na tabela; e códigos como "1650" são títulos de grupo, não operações.',
    detectar(model) {
        const erros = [];
        const dom = model.dominio;
        const temTabela = !!(dom && dom.cfopSet && dom.cfopSet.size);

        for (const l of (model.porReg.get('C170') || [])) {
            const cfop = String(l.f[11] || '').trim();
            const base = { bloco: 'C', registro: 'C170', linha: l.n, campo: 'CFOP', campoIdx: 11, severidade: 'BLOQ' };

            // 1) formato — tem precedência: é outro defeito, com outra correção.
            if (!CFOP_OK(cfop)) {
                const codNat = String(l.f[12] || '').trim();
                const sug = CFOP_OK(codNat) ? codNat : '';
                erros.push(Object.assign({}, base, {
                    valorAtual: cfop || '(vazio)',
                    valorSugerido: sug || undefined,
                    detalhe: `CFOP "${cfop}" inválido (deve ter 4 dígitos iniciando em 1/2/3/5/6/7).` +
                        (sug ? ` Provável CFOP correto: ${sug} (estava no COD_NAT por deslocamento de campo).` : ''),
                }));
                continue;
            }

            if (!temTabela) continue; // sem tabela não dá para afirmar mais nada

            // 2) existe?
            if (!dom.cfopSet.has(cfop)) {
                erros.push(Object.assign({}, base, {
                    valorAtual: cfop,
                    detalhe: `CFOP ${cfop} não existe na Tabela de Código Fiscal de Operações e Prestações.`,
                }));
                continue;
            }

            // 3) existe, mas é título de grupo
            if (dom.cfopGrupo && dom.cfopGrupo.has(cfop)) {
                erros.push(Object.assign({}, base, {
                    valorAtual: cfop,
                    detalhe: `CFOP ${cfop} é um cabeçalho de GRUPO da tabela (título de seção), não um código de operação. Use um código específico dentro do grupo.`,
                }));
            }
        }
        return erros;
    },
};
