// mailService — envio de e-mail transacional via Resend (API REST, sem SDK).
// Se RESEND_API_KEY não estiver setada, NÃO envia: apenas loga (modo dev/local).
const logger = require('./logger');

async function enviarEmail({ to, subject, html }) {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.MAIL_FROM || 'AudiSped <no-reply@audisped.com.br>';
    if (!apiKey) {
        logger.warn(`[mail] RESEND_API_KEY ausente — e-mail NÃO enviado (modo dev). to=${to} subject="${subject}"`);
        return { sent: false, reason: 'no-api-key' };
    }
    try {
        const resp = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from, to, subject, html }),
        });
        if (!resp.ok) {
            const t = await resp.text().catch(() => '');
            logger.error(`[mail] Resend falhou ${resp.status}: ${t}`);
            return { sent: false, reason: `http-${resp.status}` };
        }
        return { sent: true };
    } catch (e) {
        logger.error(`[mail] erro ao enviar: ${e.message}`);
        return { sent: false, reason: e.message };
    }
}

// Monta o e-mail de redefinição de senha.
function emailRedefinicao(nome, link) {
    const subject = 'Redefinição de senha — AudiSped';
    const html = `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a2129">
          <h2 style="color:#1a2129">Redefinição de senha</h2>
          <p>Olá${nome ? ', ' + nome : ''}. Recebemos um pedido para redefinir a senha da sua conta no AudiSped.</p>
          <p>Clique no botão abaixo para escolher uma nova senha. O link <b>expira em 30 minutos</b> e só pode ser usado uma vez.</p>
          <p style="margin:24px 0">
            <a href="${link}" style="background:#a97142;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600">Redefinir minha senha</a>
          </p>
          <p style="font-size:12px;color:#64748b">Se você não pediu isso, ignore este e-mail — sua senha continua a mesma.</p>
          <p style="font-size:12px;color:#64748b">Se o botão não funcionar, copie este link: <br>${link}</p>
        </div>`;
    return { subject, html };
}

module.exports = { enviarEmail, emailRedefinicao };
