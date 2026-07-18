// demoPaywall — bloqueio de download no ambiente de DEMONSTRAÇÃO.
//
// Contexto: a instância demo (DEMO_MODE=1) roda a MESMA imagem do backend apontando
// para um banco descartável (audisped_demo_db), com um único usuário (role 'demo').
// O prospect experimenta o produto inteiro na tela com o SPED real dele — mas NÃO
// pode extrair o deliverable (SPED fiscal corrigido .txt, LMC impresso). As PROVAS
// (PDF de correções, dossiê, rentabilidade) permanecem liberadas: NÃO montar este
// middleware nelas. Ver spec 2026-07-18-ambiente-demo-prospects-design.md.
//
// Por que guardar por DEMO_MODE e não por role: o JWT não carrega 'role' (só id/nome/
// email), então checar role exigiria ida ao banco. Na instância demo TODO request é o
// usuário demo, então DEMO_MODE=1 já é condição suficiente e à prova de falhas. Em
// produção DEMO_MODE é ausente → o middleware é totalmente transparente (chama next).
//
// Uso: montar como middleware ANTES do handler nas rotas de deliverable:
//   app.get('/api/exportar-sped/:id', authMiddleware, demoPaywall, async (req,res)=>{...})
//
// EXCEÇÃO — chamadas INTERNAS do sistema: alguns fluxos legítimos (Re-validar, gerar o
// relatório "o que foi corrigido") geram o SPED corrigido POR DENTRO, via fetch a
// /api/exportar-sped com um token de sistema (email 'sys@local', assinado com o JWT_SECRET
// no servidor). Essas NÃO podem ser bloqueadas — senão a re-validação quebra na demo. Um
// usuário demo não consegue forjar esse token. Bloqueamos só o download DIRETO do usuário.
const EMAIL_SISTEMA = 'sys@local';

function demoPaywall(req, res, next) {
    if (process.env.DEMO_MODE === '1' && req.user && req.user.email !== EMAIL_SISTEMA) {
        return res.status(402).json({
            paywall: true,
            erro: 'Assine para baixar o arquivo. No ambiente de demonstração você testa tudo, mas o download do arquivo corrigido é exclusivo para assinantes.',
        });
    }
    return next();
}

module.exports = demoPaywall;
