# Inventário do que está EM PRODUÇÃO — AudiSped

> **Deploy:** commit `b92f030` na VPS (`187.127.5.210`) em 2026-07-11.
> A VPS rodava uma versão de ~3 semanas atrás, então subiu **todo o desenvolvimento recente** (98 commits).
> Abaixo os **entregáveis significativos**, um a um, com a função de cada.

---

## 🎨 1. Visual — Design System "Aferição"
Reconstrução visual completa do sistema: novos **tokens de cor e fontes**, **casca responsiva** (menu lateral, barra superior, `App.vue`), e **migração de todas as telas e componentes** para o novo padrão. Login centralizado; sem gradientes/hex soltos; breakpoint unificado (100% responsivo).
**Função:** deixar o sistema com aparência corporativa, limpa e consistente, funcionando bem em qualquer tamanho de tela.

---

## 🔍 Validador SPED — DETECÇÃO de erros
O Validador lê o SPED importado e aponta inconsistências (reproduzindo o E-Auditor), com correção quando possível.

**2. Catálogo de Leiaute + tela "Catálogo de Regras"**
Cataloga os ~50 registros do SPED de posto e mostra ao admin as regras/leiaute.
**Função:** referência do que o sistema conhece e valida.

**3. As 10 regras do catálogo E-Auditoria**
Códigos `2890, 2075, 2951, 2800, 2037, 2481, 2441, 2321, 2451, 1003`. Cada uma detecta uma inconsistência específica (VL_DOC divergente, ICMS sem base, VL_RED_BC indevido, 9900 REG_BLC, COD_NAT=CFOP, 0206 sem 1300, COD_CTA vazio, 5929/6929, etc.).
**Função:** achar no arquivo os mesmos erros que o E-Auditor acharia — antes de transmitir.

**4. Regra CEST + tabelas oficiais NCM/CEST (CONFAZ 142/2018)**
Detecta CEST inválido no 0200 e cruza NCM↔CEST usando a tabela oficial.
**Função:** evitar rejeição por CEST/NCM incorretos.

**5. Regra 0100 (contabilista) + edição de cadastro na tela**
Aponta 0100 sem CPF/CRC/EMAIL (obrigatórios) e permite editar a IE (registro 0000) e os dados do contador direto na tela → aplicado no export.
**Função:** corrigir dados cadastrais que o PVA exige, sem voltar ao ERP.

**6. Lacre 1360 (bomba) + lista suspensa de CEST no 0200**
Detecção do lacre + apoio ao preenchimento do CEST por lista.
**Função:** facilitar campos que o usuário erra com frequência.

**7. Vincular COD_ITEM órfão (C170) a um produto 0200**
Quando um item do C170 não existe no 0200, uma lista suspensa (estilo PVA) permite apontá-lo ao produto certo — vale para todas as notas com aquele item.
**Função:** resolver "item não cadastrado" sem inventar produto/NCM.

---

## 🔧 Validador — CORREÇÕES aplicadas no export
O arquivo original nunca é alterado; as correções entram no "SPED corrigido" que você baixa.

**8. "Corrigir todas as seguras" (correção em lote)**
Um clique aplica todas as correções determinísticas seguras (ex.: 742 notas com VL_OUT_DA espúrio → 0,00), com **prévia** antes de gravar e **desfazer** o lote inteiro.
**Função:** consertar centenas de ocorrências iguais de uma vez, com segurança e reversível.

**9. Fix uso/consumo x90 (C190 órfão)**
Para entradas de uso/consumo (CFOP 1407/1556/2407/2556), zera o ICMS próprio **em lockstep** com o relabel do CST para x90, com **gate de ST** (não mexe em linha com ICMS-ST). Elimina o erro "combinação CST/CFOP/ALIQ sem item (C190)".
**Função:** deixar o C170 e o C190 coerentes por construção — sem bitributação nem órfão.

**10. Injeção do E116 ausente + 0150 da credenciadora**
Injeta o registro de apuração E116 (COD_REC 0767, vencimento correto) quando falta, e o 0150 da credenciadora com os dados do posto.
**Função:** completar registros obrigatórios que o ERP não gerou.

**11. Biblioteca de credenciadoras (maquininhas)**
Principais adquirentes pré-cadastradas por CNPJ (Stone como padrão no fallback).
**Função:** preencher o 0150 das maquininhas automaticamente.

**12. Coerência do D100 (CT-e)**
Ajusta IND_EMIT × IND_OPER (ciente do CFOP) e limpa campos de D100 cancelado/denegado.
**Função:** evitar rejeição de documentos de transporte.

**13. Ajustes de tributação (C191, 0200, E110/E210)**
Zera VL_FCP_RET quando o C190 pai não é ST; deduplica 0200 (COD_ITEM repetido); corrige apuração de ICMS/ST para CST monofásico em entrada.
**Função:** fechar os totalizadores e a apuração corretamente.

---

## 📋 Validador — RELATÓRIO e usabilidade

**14. Relatório "O que foi corrigido"**
Mostra o changelog do export (antes → depois), agrupado por bloco/registro, com contagem "×N" para correções em massa; inclui as correções que você aplicou.
**Função:** transparência total do que o sistema mudou no arquivo.

**15. Relatório consolidado em PDF**
Documento para enviar à contabilidade/fiscal; baixa direto (download real, sem popup).
**Função:** comprovar as correções para terceiros.

**16. Ligar/desligar (religar) correções por item**
Você pode desligar uma correção que não quer aplicar e **religar** depois (faixa "Correções desligadas").
**Função:** controle fino sobre o que entra no arquivo final.

**17. Tabela de inconsistências agrupada por tipo + cards clicáveis**
Os erros aparecem em tabela (estilo E-Auditor): Tipo · Registro · Ocorrências · Código · Categoria · Dica. Os cards do resumo (Bloqueantes/Advertências) são clicáveis e filtram a tabela.
**Função:** navegar centenas de erros sem rolar sem fim.

**18. Marca no "Analisar" os erros já corrigidos**
Sinaliza o que você já resolveu, para não confundir ao reanalisar.
**Função:** evitar a sensação de "a correção não pegou".

---

## 🔐 Segurança (PASSO 0 do futuro SaaS)

**19. authMiddleware nas rotas abertas**
Rotas de dados/destrutivas que estavam públicas passaram a exigir login (token).
**Função:** fechar buracos de segurança antes do multi-inquilino.

**20. Smoke-test de auth**
Teste que roda ANTES do deploy e falha se alguma rota sensível ficar sem proteção.
**Função:** impedir que uma rota desprotegida vá pra produção.

---

## 📄 Sigilo e planejamento

**21. Anonimização de dados (LGPD) + gitignore de arquivos sensíveis**
Remove dados reais de cliente do repositório e ignora arquivos forenses/segredos.
**Função:** conformidade e sigilo fiscal.

**22. Documentação do plano SaaS (multi-inquilino)**
`PLANO_CONTROLE_USUARIOS_SAAS.md` — papéis (super_admin/staff/admin/escritório), isolamento por rede, módulos, cobrança, reset de senha.
**Função:** apenas **planejamento** — **NÃO há código de SaaS em produção** ainda; é o roteiro da próxima fase.

---

## Resumo
- **Em produção:** todo o Validador (detecção + correções + relatório + UI nova) e a base de segurança PASSO 0.
- **Ainda NÃO em produção:** o controle de usuários/multi-inquilino (só o plano existe).
- **Pendências de infra (pré-existentes):** HTTPS/domínio (Caddy hoje serve `http://187.127.5.210` por IP).
