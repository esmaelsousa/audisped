// EST-0000-VER-01 — COD_VER do 0000 incompatível com o PERÍODO da escrituração.
// PVA: "A versão de leiaute apresentada não é válida para o período informado."
//
// O leiaute 020 vale para períodos a partir de jan/2026 (acrescenta o CAP_TANQUE ao 1310). Um
// arquivo de 2026 declarado em versão anterior é reprovado logo no 0000 — e, em cascata, TODO 1310
// vira "número de campos difere do leiaute", porque o PVA passa a cobrar 10 campos.
//
// Caso real: POSTO PIRAÍ II (09172184000222) 08/2026 em leiaute 018 → 156 erros no PVA
// (1 de versão + 155 de 1310). O nosso Validador dava ZERO: as demais regras conferem o arquivo
// contra a versão DECLARADA, e em 018 o 1310 com 9 campos está certo. Ninguém olhava a versão em si.
//
// jaCorrigidoNoExport: o export transmuta o COD_VER e preenche o CAP_TANQUE do 1310 (e ABORTA com
// 422 se a capacidade não estiver em lugar nenhum). Esta regra existe para o erro aparecer ANTES,
// na tela, já marcado como resolvido no download — e não só quando o PVA reprova.
const { versaoAlvoLeiaute } = require('../../spedCostureiraService');

module.exports = {
    id: 'EST-0000-VER-01',
    bloco: '0',
    registro: '0000',
    titulo: 'Versão do leiaute (COD_VER) inválida para o período da escrituração',
    severidade: 'BLOQ',
    classeCorrecao: 'estrutural-seguro',
    jaCorrigidoNoExport: true,
    instrucaoERP: 'No ERP, gere a EFD no leiaute vigente para a competência: períodos a partir de jan/2026 exigem o leiaute 020, que inclui a Capacidade do Tanque (CAP_TANQUE) em cada registro 1310.',
    detectar(model) {
        const l = (model.porReg.get('0000') || [])[0];
        if (!l) return [];
        const atual = String(l.f[2] || '').trim();
        const alvo = versaoAlvoLeiaute(atual, String(l.f[4] || '').trim()); // f[4] = DT_INI
        if (!alvo) return [];
        return [{
            bloco: '0', registro: '0000', linha: l.n,
            campo: 'COD_VER', campoIdx: 2,
            valorAtual: atual, valorSugerido: alvo,
            detalhe: `Leiaute ${atual} não é válido para o período ${String(l.f[4] || '')}: a partir de jan/2026 vale o ${alvo}. O download já sai no ${alvo}, com o CAP_TANQUE preenchido nos registros 1310.`,
        }];
    },
};
