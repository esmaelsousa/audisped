// Teste do certInfo: extração de CNPJ/validade de um .pfx real gerado in-test (node-forge).
//   node backend/tests/cert-info.test.js
const assert = require('assert');
const forge = require('node-forge');
const { lerCertificado, extrairCnpjDoCN, titularDoCN, avaliarValidade } = require('../services/certInfo');

let pass = 0, fail = 0; const fails = [];
const t = (nome, fn) => { try { fn(); pass++; } catch (e) { fail++; fails.push(`${nome} → ${e.message}`); } };

// Gera um .pfx (base64) auto-assinado com CN "<nome>:<cnpj>" e validade até `notAfter`.
function gerarP12({ nome, cnpj, notAfter, senha }) {
    const keys = forge.pki.rsa.generateKeyPair(1024); // 1024 = rápido p/ teste
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date(2020, 0, 1);
    cert.validity.notAfter = notAfter;
    const attrs = [{ name: 'commonName', value: `${nome}:${cnpj}` }];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.sign(keys.privateKey);
    const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], senha, { algorithm: '3des' });
    const der = forge.asn1.toDer(asn1).getBytes();
    return Buffer.from(der, 'binary').toString('base64');
}

// ---- pure helpers ----
t('extrairCnpjDoCN: e-CNPJ "NOME:CNPJ"', () => {
    assert.equal(extrairCnpjDoCN('POSTO TESTE LTDA:12345678000190'), '12345678000190');
});
t('extrairCnpjDoCN: sem CNPJ (e-CPF) → null', () => {
    assert.equal(extrairCnpjDoCN('FULANO DE TAL:12345678901'), null); // 11 díg (CPF) não casa 14
});
t('titularDoCN: só o nome antes do ":"', () => {
    assert.equal(titularDoCN('POSTO TESTE LTDA:12345678000190'), 'POSTO TESTE LTDA');
});
t('avaliarValidade: vencido', () => {
    const r = avaliarValidade(new Date('2026-01-01'), new Date('2026-07-13'));
    assert.equal(r.vencido, true); assert.ok(r.diasParaVencer < 0);
});
t('avaliarValidade: perto de vencer (<30d)', () => {
    const r = avaliarValidade(new Date('2026-07-30'), new Date('2026-07-13'));
    assert.equal(r.vencido, false); assert.equal(r.perto, true); assert.equal(r.diasParaVencer, 17);
});
t('avaliarValidade: ok (longe)', () => {
    const r = avaliarValidade(new Date('2027-08-20'), new Date('2026-07-13'));
    assert.equal(r.vencido, false); assert.equal(r.perto, false); assert.ok(r.diasParaVencer > 300);
});

// ---- round-trip com .pfx real ----
t('lerCertificado: extrai titular, cnpj e validade de um .pfx', () => {
    const b64 = gerarP12({ nome: 'POSTO AMARAL LTDA', cnpj: '37264533000190', notAfter: new Date(2027, 7, 20), senha: 'segredo' });
    const info = lerCertificado(b64, 'segredo');
    assert.equal(info.cnpj, '37264533000190');
    assert.equal(info.titular, 'POSTO AMARAL LTDA');
    assert.equal(info.validadeFim.getFullYear(), 2027);
});
t('lerCertificado: senha errada → erro amigável (CERT_PARSE)', () => {
    const b64 = gerarP12({ nome: 'X LTDA', cnpj: '11222333000181', notAfter: new Date(2027, 0, 1), senha: 'certa' });
    let err = null;
    try { lerCertificado(b64, 'ERRADA'); } catch (e) { err = e; }
    assert.ok(err, 'deveria lançar'); assert.equal(err.code, 'CERT_PARSE');
});

console.log(`certInfo — ${pass} passou, ${fail} falhou (de ${pass + fail})`);
if (fail) { console.log('FALHAS:'); fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
