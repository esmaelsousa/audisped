const forge = require('node-forge');
const crypto = require('crypto');
require('dotenv').config();

const ALGORITHM = 'aes-256-cbc';
const ENCRYPTION_KEY = process.env.CERT_ENCRYPTION_KEY || 'default-master-key-security-00000000'; // 32 chars
const IV_LENGTH = 16;

/**
 * Criptografa a senha do certificado
 */
function encrypt(text) {
    let iv = crypto.randomBytes(IV_LENGTH);
    let cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32)), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

/**
 * Descriptografa a senha do certificado
 */
function decrypt(text) {
    let textParts = text.split(':');
    let iv = Buffer.from(textParts.shift(), 'hex');
    let encryptedText = Buffer.from(textParts.join(':'), 'hex');
    let decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32)), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
}

/**
 * Faz o parsing do arquivo PFX para extrair metadados e validar a senha
 */
function getCertificateMetadata(pfxBase64, password) {
    try {
        const pfxDer = forge.util.decode64(pfxBase64);
        const pfxAsn1 = forge.asn1.fromDer(pfxDer);
        const pfx = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, password);

        // Busca a bolsa de certificados (safe contents)
        let cert = null;
        for (let i = 0; i < pfx.safeContents.length; i++) {
            const safeContent = pfx.safeContents[i];
            for (let j = 0; j < safeContent.safeEntries.length; j++) {
                const safeEntry = safeContent.safeEntries[j];
                if (safeEntry.cert) {
                    cert = safeEntry.cert;
                    break;
                }
            }
            if (cert) break;
        }

        if (!cert) throw new Error("Certificado não encontrado no arquivo PFX.");

        const validity = cert.validity;
        const serial = cert.serialNumber;
        const subject = cert.subject.attributes.map(a => `${a.shortName || a.name}=${a.value}`).join(', ');

        // Tenta extrair CNPJ do subject (campo commonName ou via OID se disponível)
        const commonName = cert.subject.getField('CN').value;

        return {
            valide_inicio: validity.notBefore,
            validade_fim: validity.notAfter,
            serial_number: serial,
            subject: subject,
            common_name: commonName,
            status: 'VALID'
        };
    } catch (error) {
        throw new Error(`Erro ao ler certificado PFX: ${error.message}`);
    }
}

module.exports = {
    encrypt,
    decrypt,
    getCertificateMetadata
};
