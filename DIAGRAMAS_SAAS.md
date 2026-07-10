/# Diagramas — Controle de Usuários & SaaS (AudiSped)

> Companheiro visual do `PLANO_CONTROLE_USUARIOS_SAAS.md`.
> **Como ver:** abra o **preview de Markdown** do IDE (ou abra este arquivo no GitHub) — os blocos `mermaid` renderizam automaticamente. Zero instalação.

---

## 1. Modelo de dados (ER) — núcleo SaaS

```mermaid
erDiagram
    PLANOS ||--o{ REDES : "template de preço"
    REDES ||--o{ EMPRESAS : "tem CNPJs"
    REDES ||--o{ USUARIOS : "tem usuários"
    REDES ||--o{ FATURAS : "fatura mensal"
    REDES ||--o{ WEBHOOK_EVENTS : "eventos Asaas"
    USUARIOS ||--o{ USUARIO_EMPRESAS : "escopo fino"
    EMPRESAS ||--o{ USUARIO_EMPRESAS : "designada a"
    EMPRESAS ||--o{ SPED_ARQUIVOS : "arquivos"
    EMPRESAS ||--o{ DE_PARA_XML : "de-para por rede"
    EMPRESAS ||--o{ REGRAS_FISCAIS : "regras por rede"

    REDES {
        int id PK
        text nome
        text status "trial..suspensa..cancelada"
        jsonb modulos_contratados
        date trial_ate
        int dias_carencia
        numeric preco_por_cnpj
        numeric desconto_pct
        numeric desconto_valor
        date desconto_ate
        text asaas_customer_id "Fase 5"
        text asaas_subscription_id "Fase 5"
    }
    EMPRESAS {
        int id PK
        text cnpj "UK cnpj+rede_id"
        int rede_id FK
        text status "ativo/suspenso/arquivado"
    }
    USUARIOS {
        int id PK
        text email
        text role "super_admin/admin/escritorio"
        int rede_id FK "null p/ super"
        jsonb modulos
        bool ativo
    }
    USUARIO_EMPRESAS {
        int usuario_id FK
        int empresa_id FK
    }
    FATURAS {
        int id PK
        int rede_id FK
        text competencia "UK rede+competencia"
        int qtd_cnpjs
        numeric preco_unitario "snapshot"
        numeric desconto_aplicado "snapshot"
        numeric valor "snapshot congelado"
        text status "aberta/paga/vencida/cancelada"
        date vencimento
        text asaas_invoice_id "Fase 5"
    }
    PLANOS {
        text chave PK
        text nome
        numeric preco_cnpj
        jsonb modulos
    }
    WEBHOOK_EVENTS {
        text asaas_event_id PK
        text tipo
        timestamp recebido_em
    }
```

> ⚠️ **REVISTO (§13.1 do plano):** só `de_para_xml` ganha `rede_id` (per-tenant). **`regras_fiscais` fica GLOBAL** (motor do export; per-tenant regride o SPED aos valores crus do XML). `cad_cfops`/`ncm`/`cest`/catálogo seguem globais (read-only).

---

## 2. Máquina de estados de acesso / cobrança

```mermaid
stateDiagram-v2
    [*] --> trial : conta criada
    trial --> ativa : pagou / ativou
    trial --> em_atraso : trial_ate venceu
    ativa --> em_atraso : fatura venceu
    em_atraso --> ativa : pagou (zero vencidas)
    em_atraso --> suspensa : passou dias_carencia
    suspensa --> ativa : pagou
    ativa --> cancelada : cancelamento
    em_atraso --> cancelada : cancelamento
    suspensa --> cancelada : cancelamento
    cancelada --> [*]

    note right of suspensa
        ACESSO BLOQUEADO
        redireciona p/ Portal Financeiro
    end note
    note right of ativa
        acionadores da transicao:
        v1 = manual (Console Super Admin)
        Fase 5 = webhook Asaas
    end note
```

---

## 3. Cadeia de autorização no backend (por requisição)

```mermaid
flowchart TD
    REQ["Requisicao /api/*"] --> AUTH{"requireAuth<br/>token valido?"}
    AUTH -->|nao| R401["401 sem token"]
    AUTH -->|sim| ENRICH["enrich: busca role + rede_id do banco<br/>(nunca do token; cache 30s)"]
    ENRICH --> ACTIVE{"requireActiveAccount<br/>rede ativa?"}
    ACTIVE -->|suspensa / cancelada| R402["402 -> Portal Financeiro"]
    ACTIVE -->|super_admin| BYPASS["bypass de escopo"]
    ACTIVE -->|ativa / trial / em_atraso| ROLE{"requireRole<br/>nivel suficiente?"}
    ROLE -->|nao| R403a["403"]
    ROLE -->|sim| MOD{"requireModule<br/>modulo liberado?"}
    MOD -->|nao| R403b["403 modulo nao contratado"]
    MOD -->|sim| OWN{"ownership-check<br/>objeto pertence a rede?"}
    OWN -->|nao| R403c["403 IDOR bloqueado"]
    OWN -->|sim| OK["serve dados DA REDE"]
    BYPASS --> OK
```

> O **ownership-check** (não só filtro de lista) é o achado crítico §12.1 — vale em toda rota com `:id`.

---

## 4. Fluxo de cobrança automática (Fase 5 — Asaas)

```mermaid
sequenceDiagram
    autonumber
    participant Job as Job diario
    participant Sys as AudiSped
    participant Cli as Cliente
    participant Asaas

    Job->>Sys: fatura vencida + carencia estourou
    Sys->>Sys: rede.status = suspensa
    Cli->>Sys: tenta acessar o sistema
    Sys-->>Cli: 402 -> Portal Financeiro (faturas)
    Cli->>Asaas: paga via PIX ou cartao (checkout Asaas)
    Asaas-->>Sys: webhook PAYMENT_CONFIRMED (idempotente por evt_id)
    Sys->>Sys: rede.status = ativa
    Sys-->>Cli: acesso liberado automaticamente
```

---

*Editar estes diagramas: pode ajustar o Mermaid direto aqui (texto), ou — se um dia instalar a extensão draw.io — exportar para `.drawio`. Por enquanto, render automático no preview do Markdown.*
