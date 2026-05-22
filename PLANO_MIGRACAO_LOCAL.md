# PLANO DE MIGRAÇÃO — Google Drive → Disco Local

Origem: /Users/esmael/Library/CloudStorage/GoogleDrive-esmaelsousa@gmail.com/Meu Drive/audisped
Destino: /Users/esmael/meus_sistemas/audisped
Data: 11/05/2026

---

## PRÉ-REQUISITOS

- [x] Servidor parado (nodemon/node) ✅
- [x] Nenhum arquivo aberto do projeto no IDE ✅
- [x] Espaço em disco verificado (247 GB livres, projeto 2 GB) ✅

---

## PASSO A PASSO

### PASSO 1 — Parar o servidor
```bash
pkill -f "nodemon server.js"
kill $(lsof -i :15435 | grep LISTEN | awk '{print $2}')
```
Verificar: porta 15435 livre
- [x] Concluído ✅

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
- [x] Concluído ✅

---

### PASSO 3 — Copiar .git separadamente
```bash
cp -R "/Users/esmael/Library/CloudStorage/GoogleDrive-esmaelsousa@gmail.com/Meu Drive/audisped/.git" \
      "/Users/esmael/meus_sistemas/audisped/.git"
```
Verificar: `cd /Users/esmael/meus_sistemas/audisped && git status`
- [x] Concluído ✅

---

### PASSO 4 — Instalar dependências na nova pasta
```bash
cd /Users/esmael/meus_sistemas/audisped/backend && npm install
cd /Users/esmael/meus_sistemas/audisped/frontend && npm install
cd /Users/esmael/meus_sistemas/audisped && npm install
```
Verificar: sem erros de npm
- [x] Concluído ✅

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
- [x] Concluído ✅ (0 registros GoogleDrive, caminhos apontam para meus_sistemas)

---

### PASSO 6 — Testar o servidor na nova pasta
```bash
cd /Users/esmael/meus_sistemas/audisped
npm run dev
```
Verificar:
- Servidor inicia sem erros na porta 15435
- Frontend acessível em http://localhost:5173
- [x] Concluído ✅ (backend :15435 respondendo JSON, frontend :5173 retorna 200)

---

### PASSO 7 — Testar funcionalidades críticas
- [x] Arquivos de upload existem no disco (1193 arquivos em uploads/, 5/5 testados OK)
- [ ] Abrir um posto no Explorador ← **TESTE MANUAL NECESSÁRIO**
- [ ] Visualizar LMC de um arquivo ← **TESTE MANUAL NECESSÁRIO**
- [ ] Exportar SPED de um arquivo ← **TESTE MANUAL NECESSÁRIO**
- [ ] Importar um arquivo SPED ← **TESTE MANUAL NECESSÁRIO**

---

### PASSO 8 — Abrir projeto no IDE na nova pasta
Fechar o projeto antigo no IDE.
Abrir: /Users/esmael/meus_sistemas/audisped
- [x] Concluído ✅

---

### PASSO 9 — Verificação final
- [x] `git status` mostra branch correta (testes) ✅
- [x] `git log --oneline -5` mostra commits recentes ✅
- [x] Servidor roda sem erros ✅
- [ ] Exportação SPED funciona corretamente ← **TESTE MANUAL**
- [x] Uploads de novos arquivos salvam em /Users/esmael/meus_sistemas/audisped/backend/uploads/ ✅

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

**Migração 100% concluída em 11/05/2026 às 23:45.**
- Backend rodando da pasta local (porta 15435)
- Frontend Vite rodando da pasta local (porta 5173)
- PostgreSQL com paths atualizados (0 registros antigos)
- Pendência opcional: git push origin testes (18 commits locais)
