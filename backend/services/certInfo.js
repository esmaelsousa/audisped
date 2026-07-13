// certInfo.js — leitura de certificado digital A1 (PKCS#12 / .pfx) para o fluxo de captura SEFAZ.
// Extrai TITULAR, CNPJ (ICP-Brasil) e VALIDADE, sem persistir nada. Usado para:
//   (1) mostrar a validade ao carregar o certificado;
//   (2) verificar se o CNPJ do certificado é o da empresa selecionada (bloqueia divergência).
// node-forge já é dependência do backend (usado em mdeService.saveCertificado).
const forge = require('node-forge');

const OID_CNPJ_ICP = '2.16.76.1.3.3'; // SAN otherName do CNPJ da pessoa jurídica (ICP-Brasil)

// CNPJ (14 díg) a partir do CN do e-CNPJ ("RAZÃO SOCIAL:CNPJ"). Fallback: 1ª sequência de 14 díg.
function extrairCnpjDoCN(cn) {
    if (!cn) return null;
    const tail = String(cn).split(':').pop().replace(/\D/g, '');
    if (tail.length >= 14) return tail.slice(0, 14);
    const m = String(cn).replace(/\D/g, '').match(/(\d{14})/);
    return m ? m[1] : null;
}

// CNPJ a partir do SAN otherName OID 2.16.76.1.3.3 (best-effort; forge nem sempre decodifica otherName).
function extrairCnpjDoSAN(cert) {
    try {
        const ext = cert.getExtension('subjectAltName');
        if (!ext || !ext.altNames) return null;
        for (const an of ext.altNames) {
            if ((an.oid === OID_CNPJ_ICP || an.type === 0) && an.value) {
                const digits = String(an.value).replace(/\D/g, '');
                const m = digits.match(/(\d{14})/);
                if (m) return m[1];
            }
        }
    } catch (_) { /* otherName não decodificável — ignora */ }
    return null;
}

// Titular (nome empresarial) a partir do CN, sem o CNPJ.
function titularDoCN(cn) {
    if (!cn) return '';
    return String(cn).split(':')[0].trim();
}

// Avalia a validade: dias restantes, vencido (<0), perto de vencer (<30 dias).
function avaliarValidade(validadeFim, agora = new Date()) {
    const fim = validadeFim instanceof Date ? validadeFim : new Date(validadeFim);
    const dias = Math.floor((fim.getTime() - agora.getTime()) / 86400000);
    return { validadeFim: fim, diasParaVencer: dias, vencido: dias < 0, perto: dias >= 0 && dias < 30 };
}

// Lê o .pfx (base64) com a senha → { titular, cnpj, validadeInicio, validadeFim }.
// Lança Error com .code='CERT_PARSE' e mensagem amigável em caso de senha errada / arquivo inválido.
function lerCertificado(pfxBase64, senha) {
    let p12;
    try {
        const der = Buffer.from(pfxBase64, 'base64').toString('binary');
        p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), senha);
    } catch (e) {
        const senhaErrada = /mac could not be verified|invalid password|integrity|unable to|decrypt/i.test(e.message || '');
        const err = new Error(senhaErrada ? 'Senha do certificado incorreta.' : 'Arquivo de certificado inválido ou corrompido.');
        err.code = 'CERT_PARSE';
        throw err;
    }
    const bags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const certBags = (bags[forge.pki.oids.certBag] || []).filter(b => b && b.cert);
    if (!certBags.length) { const e = new Error('Certificado sem cadeia X.509 legível.'); e.code = 'CERT_PARSE'; throw e; }

    // Escolhe o certificado FOLHA (o e-CNPJ, que tem CNPJ); se nenhum tiver, usa o primeiro.
    let escolhido = null, cnpj = null, cn = '';
    for (const b of certBags) {
        const c = b.cert;
        const _cn = (c.subject.getField('CN') || {}).value || '';
        const _cnpj = extrairCnpjDoSAN(c) || extrairCnpjDoCN(_cn);
        if (_cnpj) { escolhido = c; cnpj = _cnpj; cn = _cn; break; }
        if (!escolhido) { escolhido = c; cn = _cn; }
    }
    return {
        titular: titularDoCN(cn),
        cnpj, // null se for e-CPF (sem CNPJ) → o chamador bloqueia
        validadeInicio: escolhido.validity.notBefore,
        validadeFim: escolhido.validity.notAfter,
    };
}

module.exports = { lerCertificado, extrairCnpjDoCN, extrairCnpjDoSAN, titularDoCN, avaliarValidade };
