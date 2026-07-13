// Teste puro do CapturaProvider (camada agnóstica). Sem DB/HTTP real (client injetado).
//   node backend/tests/captura-provider.test.js
const assert = require('assert');
const { getProvider, danfeRapidaProvider, espiaoProvider } = require('../services/captura/capturaProvider');

let pass = 0, fail = 0; const fails = [];
const t = (nome, fn) => fn().then(() => pass++).catch(e => { fail++; fails.push(`${nome} → ${e.message}`); });
const XML_OK = '<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe123"><ide/></infNFe></NFe></nfeProc>';

(async () => {
    await t('getProvider default = espiao', async () => {
        assert.equal(getProvider().nome, 'espiao');
        assert.equal(getProvider('danfe_rapida').nome, 'danfe_rapida');
    });
    await t('espiao suporta descoberta; danfe não', async () => {
        assert.equal(espiaoProvider.suportaDescoberta, true);
        assert.equal(getProvider('danfe_rapida').suportaDescoberta, false);
    });
    await t('danfe: baixa xmlCode e devolve {xml, origem}', async () => {
        const fakeClient = { get: async () => ({ data: { xmlCode: XML_OK } }) };
        const p = danfeRapidaProvider('dr_live_fake', { client: fakeClient });
        const r = await p.baixarXmlPorChave('35260011222333000181550010000000011000000017');
        assert.equal(r.origem, 'danfe_rapida');
        assert.ok(r.xml.includes('infNFe'));
    });
    await t('danfe: sem xmlCode → erro', async () => {
        const fakeClient = { get: async () => ({ data: { message: 'Not Found' } }) };
        const p = danfeRapidaProvider('dr_live_fake', { client: fakeClient });
        let threw = false;
        try { await p.baixarXmlPorChave('x'); } catch { threw = true; }
        assert.ok(threw, 'deveria lançar quando não há xmlCode');
    });
    await t('danfe: sem API key → erro', async () => {
        const p = danfeRapidaProvider('', { client: { get: async () => ({}) } });
        let threw = false;
        try { await p.baixarXmlPorChave('x'); } catch { threw = true; }
        assert.ok(threw, 'deveria lançar sem API key');
    });
    await t('danfe: manifestar não suportado → erro', async () => {
        const p = danfeRapidaProvider('k', { client: { get: async () => ({}) } });
        let threw = false;
        try { await p.manifestar('x'); } catch { threw = true; }
        assert.ok(threw);
    });

    console.log(`CapturaProvider — ${pass} passou, ${fail} falhou (de ${pass + fail})`);
    if (fail) { console.log('FALHAS:'); fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
})();
