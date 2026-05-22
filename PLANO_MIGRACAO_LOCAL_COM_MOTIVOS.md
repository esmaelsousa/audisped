# PLANO DE MIGRAÇÃO — Google Drive → Disco Local

Origem: /Users/esmael/Library/CloudStorage/GoogleDrive-esmaelsousa@gmail.com/Meu Drive/audisped
Destino: /Users/esmael/meus_sistemas/audisped
Data: 11/05/2026

---

## MOTIVO DA MIGRAÇÃO

O projeto estava hospedado no Google Drive, que monta o sistema de arquivos via FUSE (File System in User Space). Isso causava três problemas graves:

1. **Lentidão de I/O** — Todas as leituras e escritas passavam pela camada FUSE/rede, tornando operações como `npm install`, `git status` e leitura de arquivos SPED extremamente lentas comparadas ao disco local (SSD).

2. **Bugs silenciosos de cache FUSE** — O driver FUSE do Google Drive mantém um cache local que nem sempre sincroniza corretamente. Isso causava situações onde o arquivo no disco não refletia a última escrita, gerando comportamentos inconsistentes difíceis de diagnosticar (ex: código editado que parecia não ter efeito, resultados de exportação SPED intermitentes).

3. **Instabilidade com ferramentas de desenvolvimento** — Ferramentas como `nodemon`, `git`, `node_modules` e watchers do Vite (HMR) não foram projetadas para funcionar sobre FUSE. Isso resultava em rebuilds desnecessários, locks de arquivo e falhas esporádicas do servidor.

A migração para disco local (SSD) elimina todos esses problemas, proporcionando I/O nativo (~100x mais rápido) e comportamento previsível do sistema de arquivos.

---

## PRÉ-REQUISITOS

- [ ] Servidor parado (nodemon/node)
- [ ] Nenhum arquivo aberto do projeto no IDE
- [ ] Espaço em disco verificado (247 GB livres, projeto 2 GB) ✅

---

## PASSO A PASSO

### PASSO 1 — Parar o servidor
```bash
pkill -f "nodemon server.js"
kill $(lsof -i :15435 | grep LISTEN | awk '{print $2}')
```
Verificar: porta 15435 livre
- [ ] Concluído

---

### PASSO 2 — Copiar projeto (sem node_modules, mais rápido)
```bash
rsync -av --progress \
  --exclude 'node_modules' \
  --exclude '.git' \
  "/Users/esmael/Library/CloudStorage/GoogleDrive-esmaelsousa@gmail.com/Meu Drive/audisped/" \
  "/Users/esmael/meus_sistemas/audisped/"
```
Verificar: arquivos copiados corretamente
- [ ] Concluído

---

### PASSO 3 — Copiar .git separadamente
```bash
cp -R "/Users/esmael/Library/CloudStorage/GoogleDrive-esmaelsousa@gmail.com/Meu Drive/audisped/.git" \
      "/Users/esmael/meus_sistemas/audisped/.git"
```
Verificar: `cd /Users/esmael/meus_sistemas/audisped && git status`
- [ ] Concluído

---

### PASSO 4 — Instalar dependências na nova pasta
```bash
cd /Users/esmael/meus_sistemas/audisped/backend && npm install
cd /Users/esmael/meus_sistemas/audisped/frontend && npm install
cd /Users/esmael/meus_sistemas/audisped && npm install
```
Verificar: sem erros de npm
- [ ] Concluído

---

### PASSO 5 — Atualizar caminhos no banco PostgreSQL
378 registros em sped_arquivos.caminho_arquivo apontam para o Google Drive.

```sql
UPDATE sped_arquivos
SET caminho_arquivo = REPLACE(
    caminho_arquivo,
    '/Users/esmael/Library/CloudStorage/GoogleDrive-esmaelsousa@gmail.com/Meu Drive/audisped/',
    '/Users/esmael/meus_sistemas/audisped/'
)
WHERE caminho_arquivo LIKE '%GoogleDrive%';
```

Verificar:
```sql
SELECT COUNT(*) FROM sped_arquivos WHERE caminho_arquivo LIKE '%GoogleDrive%';
-- Deve retornar 0

SELECT caminho_arquivo FROM sped_arquivos LIMIT 3;
-- Deve mostrar /Users/esmael/meus_sistemas/audisped/backend/uploads/...
```
- [ ] Concluído

---

### PASSO 6 — Testar o servidor na nova pasta
```bash
cd /Users/esmael/meus_sistemas/audisped
npm run dev
```
Verificar:
- Servidor inicia sem erros na porta 15435
- Frontend acessível em http://localhost:5173
- [ ] Concluído

---

### PASSO 7 — Testar funcionalidades críticas
- [ ] Abrir um posto no Explorador
- [ ] Visualizar LMC de um arquivo
- [ ] Exportar SPED de um arquivo (verificar se tem 0000, sem ANP fora)
- [ ] Importar um arquivo SPED (verificar se salva no novo uploads/)

---

### PASSO 8 — Abrir projeto no IDE na nova pasta
Fechar o projeto antigo no IDE.
Abrir: /Users/esmael/meus_sistemas/audisped
- [ ] Concluído

---

### PASSO 9 — Verificação final
- [ ] `git status` mostra branch correta
- [ ] `git log --oneline -5` mostra commits recentes
- [ ] Servidor roda sem erros
- [ ] Exportação SPED funciona corretamente
- [ ] Uploads de novos arquivos salvam em /Users/esmael/meus_sistemas/audisped/backend/uploads/

---

## O QUE NÃO MUDA

| Item | Razão |
|---|---|
| Banco PostgreSQL | Roda em localhost, independente da pasta |
| Git remote (GitHub) | URL do remote não muda |
| Frontend (API) | Usa URL relativa |
| .env | Só tem localhost e tokens |

## O QUE MUDA

| Item | De | Para |
|---|---|---|
| Pasta do projeto | Google Drive (FUSE) | Disco local (SSD) |
| caminho_arquivo no banco | .../GoogleDrive/.../audisped/... | .../meus_sistemas/audisped/... |
| Velocidade de leitura | Rede (FUSE) | SSD local (~100x mais rápido) |
| Cache FUSE | Causa bugs silenciosos | Eliminado |

## ERROS SPED FISCAIS EM INVESTIGAÇÃO (re-testar após migração)

Antes da migração, estávamos depurando erros graves na exportação SPED fiscal.
Parte desses bugs pode ter sido agravada ou mascarada pelo cache FUSE do Google Drive
(ex: código editado que não surtia efeito, valores lidos do arquivo que não refletiam
a última escrita). Após a migração, **todos os cenários abaixo devem ser re-testados**
no novo diretório para confirmar se os fixes aplicados funcionam de forma estável.

---

### Erro 1 — Descontinuidade de Encerrantes (Registro 1300/1310/1320)

**Empresa:** AUTO POSTO ESPLANADA LTDA — CNPJ 12.656.384/0002-65
**Período:** Janeiro/2022
**Arquivo no sistema:** ID 1154

**Sintomas encontrados:**
| # | Descrição | Produto | Gravidade |
|---|---|---|---|
| 1 | VAL_AJ_PERDA e GANHO negativos (22 campos, 11 dias) | Gasolina | CRÍTICA |
| 2 | Continuidade quebrada — 5 saltos críticos (até 63.703 L) | Gasolina | CRÍTICA |
| 3 | Continuidade quebrada — 22 saltos menores (3-8 L) | Gasolina | RELEVANTE |
| 4 | Continuidade quebrada — 28 quebras sistemáticas (3-8 L) | Diesel Comum | RELEVANTE |
| 5 | Continuidade quebrada — 7 quebras menores (2-6 L) | Diesel S10 | RELEVANTE |

**Causa raiz:** O SPED original tinha dados corrompidos nos tanques 1310 da Gasolina
(encerrantes confundidos com estoques, proporções negativas e maiores que 1).

**Fixes aplicados (commits):**
- `d6d2c8b` — correção completa Registro 1300/1310 (proporções, negativos, continuidade)
- `40a8ea9` — saneamento de PERDA/GANHO negativos
- `d1e1c52` — corrige FECH_FISICO=0 quando VAL_AJ_PERDA=ESTQ_ESCR
- `4b88f95` — propagar continuidade para registros 1300 sem ajustes
- `d40ff6b` / `d29a498` — âncora FECH do banco na redistribuição por tanques

**Re-teste:** Exportar SPED do arquivo 1154 e verificar:
- [ ] PERDA >= 0 e GANHO >= 0 em todos os registros 1300
- [ ] Continuidade: ABERT dia N = FECH dia N-1 (tolerância 2L)
- [ ] Proporções dos tanques 1310 entre 0 e 1

---

### Erro 2 — Violação da Regra ANP 0,60%

**Empresa:** AUTO POSTO ESPLANADA LTDA — CNPJ 12.656.384/0002-65
**Período:** Janeiro/2022
**Arquivo no sistema:** ID 1154

**Sintoma:** Após as correções de continuidade, alguns dias ficaram com
diferença (PERDA ou GANHO) acima de 0,60% do estoque escritural, violando
a regra fiscal da ANP que limita variações de estoque.

**Fixes aplicados (commits):**
- `74f7c63` — altera base do % ANP 0,60% para fechamento físico
- `70111e8` — mover âncora fisicoDb para DEPOIS do escudo ANP
- `bf301e5` — fisicoDb prefere fech_fisico original quando ajustado está inflado
- `65fde82` — escudo ANP prevalece sobre âncora quando ANP > 0,60%

**Re-teste:** Exportar SPED do arquivo 1154 e verificar:
- [ ] ANP <= 0,60% em todos os registros 1300 (todos os produtos)
- [ ] Escudo ANP não distorce o FECH_FISICO (não deve ficar inflado)

---

### Erro 3 — Perda do Bloco 0 em filesystem FUSE

**Sintoma:** Em algumas exportações, o bloco 0 (registros 0000, 0200)
desaparecia do SPED exportado. O bug era intermitente e só ocorria no
Google Drive (FUSE).

**Fix aplicado:**
- `806f45b` — corrige perda do bloco 0 (0000/0200) em filesystems FUSE

**Re-teste:** Exportar qualquer SPED e verificar:
- [ ] Registro 0000 presente na primeira linha
- [ ] Registros 0200 presentes para todos os produtos

---

### Erro 4 — Duplicidade de CT-e no D100

**Empresa:** LUBRINESSA XVI COMERCIO DE PETROLEO LTDA — CNPJ 29.922.765/0001-60
**Período:** Maio/2025
**Arquivo:** 29922765000160_20250501_20250531.txt

**Sintoma:** 11 CT-es do participante JG TRANSPORTES (CNPJ 35.273.019/0001-96)
aparecem duplicados no bloco D100 (22 registros em vez de 11).

**Status:** Plano de correção elaborado (PLANO_CORRECAO_D100_DUPLICIDADE.md),
ainda NÃO implementado. Aguardando aprovação.

**Re-teste após implementação:**
- [ ] Exportar SPED da LUBRINESSA e verificar que D100 duplicados foram removidos
- [ ] Contadores 9900/D990/9999 corretos
- [ ] Validar no PVA: erro de duplicidade deve sumir

---

### Erro 5 — Descontinuidade entre Meses Consecutivos

**Sintoma:** Encerrante inicial do 1º dia de cada mês parte do valor original
do SPED, não do valor final exportado do mês anterior. Gera descontinuidade
cruzando meses consecutivos.

**Status:** Plano de correção elaborado (PLANO_CONTINUIDADE_ENCERRANTES.md),
ainda NÃO implementado. Aguardando aprovação.

---

## ROLLBACK (se algo der errado)

A pasta original no Google Drive NÃO será apagada.
Se algo falhar:
1. Parar servidor na nova pasta
2. Reverter UPDATE no banco:
```sql
UPDATE sped_arquivos
SET caminho_arquivo = REPLACE(
    caminho_arquivo,
    '/Users/esmael/meus_sistemas/audisped/',
    '/Users/esmael/Library/CloudStorage/GoogleDrive-esmaelsousa@gmail.com/Meu Drive/audisped/'
)
WHERE caminho_arquivo LIKE '%meus_sistemas%';
```
3. Iniciar servidor na pasta antiga

---

## STATUS

**Aguardando autorização para iniciar.**
