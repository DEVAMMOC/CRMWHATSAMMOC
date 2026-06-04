# AMMOC CRMWhats — Design Spec
**Data:** 2026-05-28  
**Projeto:** Sistema de Gestão de WhatsApp da AMMOC  
**Supabase:** `xfqphbdurynuwvrnxpvj` · `https://xfqphbdurynuwvrnxpvj.supabase.co`  
**VPS (Evolution Go):** `2.25.139.166:8085` · API Key: configurada  
**Status:** Aprovado para implementação

---

## 1. Visão geral

Sistema web interno da AMMOC que permite a funcionários conectarem seu WhatsApp pessoal, capturarem conversas relevantes na base organizacional, gerenciarem atendimentos e transferi-los entre colegas. Um bot oficial (número da AMMOC) complementa com atendimento automático e delegação. Todo o histórico relevante é exportado diariamente para GitHub como arquivos `.json`/`.md` que servem de contexto para a AMMOC e para agentes de IA.

**Problema central:** As comunicações institucionais da AMMOC acontecem nos WhatsApps pessoais dos funcionários. Não há registro centralizado, rastreabilidade de atendimentos ou continuidade quando um funcionário está ausente.

**Solução:** Plataforma web que orquestra as instâncias Evolution Go de cada funcionário, captura as conversas escolhidas no banco central e gera contexto estruturado automaticamente.

---

## 2. Arquitetura

### Stack

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js 15 (App Router, TypeScript) |
| Backend | NestJS (TypeScript, modular monolith) |
| Banco | Supabase (PostgreSQL 17) |
| Real-time | Socket.io (WebSocket) via NestJS |
| WhatsApp | Evolution Go (`evoapicloud/evolution-go:latest`) |
| Infra | Hostinger VPS · Docker Compose |
| Arquivos contexto | GitHub via API REST (PAT) |
| Agente IA | OpenAI / Anthropic (configurável) com RAG |

### Padrão arquitetural

Modular Monolith: um único deploy NestJS com módulos fortemente isolados. Frontend e backend são processos separados (Next.js standalone + NestJS). Comunicação interna por injeção de dependência; comunicação com Evolution Go por HTTP.

### Diagrama de módulos

```
┌─────────────────────────────────────────────────────────────┐
│  Next.js Frontend                                           │
│  /dashboard  /atendimento  /admin  /configuracoes           │
└───────────────────────┬─────────────────────────────────────┘
                        │ REST + WebSocket
┌───────────────────────▼─────────────────────────────────────┐
│  NestJS Monolith                                            │
│                                                             │
│  AuthModule      WhatsAppModule    ConversationModule       │
│  AttendanceModule  ContextModule   BotModule                │
│  AgentModule     NotificationModule  AdminModule            │
└────┬──────────────────┬────────────────────────────────────-┘
     │                  │
     ▼                  ▼
  Supabase        Evolution Go
  PostgreSQL       VPS :8085
```

---

## 3. Perfis de acesso

| Perfil | Descrição |
|---|---|
| **Funcionário** | Conecta seu WhatsApp, captura conversas, gerencia seus atendimentos |
| **Supervisor** | Tudo do Funcionário + visualiza conversas e atendimentos da equipe |
| **Admin** | Acesso total: configurações, bot, GitHub sync, agente IA, integrações |

---

## 4. Módulos do sistema

### 4.1 AuthModule
- Autenticação com email + senha (Supabase Auth)
- JWT com refresh token
- Middleware de guarda por perfil (`RolesGuard`)
- Convite de funcionários por e-mail (Admin)

### 4.2 WhatsAppModule
- Cria/deleta instância Evolution Go ao funcionário conectar/desconectar
- Configura webhook por instância apontando para `POST /webhook/whatsapp/:instanceId`
- Monitora status das instâncias (online/offline/disconnected)
- Processa eventos de webhook: `messages.upsert`, `connection.update`, `qrcode.updated`
- Retorna QR code ou pairing code para conexão do funcionário
- Cron a cada 5 min: verifica instâncias e atualiza status no banco

### 4.3 ConversationModule
- Recebe mensagens via webhook e persiste no banco
- Lógica de captura automática: detecta gatilhos (palavras-chave configuráveis: prefeitura, contrato, obra, município...)
- Status de conversa: `nao_salva` → `pendente` → `ativa` → `encerrada`
- API para listar/filtrar conversas por funcionário, status, município, data
- Suporte a tipos de mensagem: texto, imagem (URL), documento, áudio (URL)

### 4.4 AttendanceModule (Atendimentos)
- Cria atendimento ao aceitar uma conversa (`pendente` → `ativa`)
- Campos: contato, município, funcionário responsável, abertura, encerramento, resumo
- **Transferência:** reassina no banco + envia mensagem automática ao contato + notifica novo responsável
- Status: `aberto` → `em_andamento` → `transferido` → `encerrado`
- Histórico completo de transferências por atendimento

### 4.5 ContextModule
- Cron diário (horário configurável, default 02:00)
- Para cada conversa com novas mensagens desde o último sync:
  - Gera `ammoc-conv-{id}.json` (estruturado: metadados + mensagens + resumo)
  - Gera `ammoc-conv-{id}.md` (legível: cabeçalho + timeline + tags)
  - Atualiza `index.md` com índice geral de todas as conversas
- Detecção incremental: compara `last_synced_at` com timestamp da última mensagem
- Push para GitHub via API REST (configurado via `github_sync_config`)
- Registra resultado em `context_file_syncs` (commit hash, arquivos, status)
- Trigger manual disponível para Admin ("Gerar contexto agora")

### 4.6 BotModule
- Número WhatsApp Business oficial da AMMOC (instância dedicada no Evolution Go)
- Regras de delegação: detecta município mencionado → encaminha ao funcionário responsável
- Resposta automática fora do horário (configurável)
- Mensagem de boas-vindas configurável
- Notifica funcionário via push ao receber delegação
- Registra todas as interações do bot no banco

### 4.7 AgentModule
- Modelo de IA configurável (GPT-4o, Claude, Gemini)
- Prompt de sistema personalizável
- Fontes RAG: GitHub (contexto WhatsApp), Supabase (base AMMOC), Google Drive, APIs externas
- Funcionalidades:
  - Sugestões de resposta em tempo real durante atendimento
  - Resumo automático ao encerrar atendimento (incluído no `.md`)
  - Respostas automáticas do bot oficial

### 4.8 NotificationModule
- WebSocket (Socket.io) para eventos em tempo real
- Eventos: nova mensagem, novo atendimento, transferência recebida, sync GitHub concluído
- Notificações in-app com badge de contagem

### 4.9 AdminModule
- Dashboard: KPIs, conversas ativas, status da equipe, últimos syncs
- Gerenciamento de funcionários (CRUD, convite, atribuição de perfil)
- Configuração de integrações (veja seção 6)

---

## 5. Modelo de dados (Supabase)

### Tabelas principais

```sql
-- Usuários do sistema
users
  id uuid PK
  email text UNIQUE
  name text
  role enum('funcionario','supervisor','admin')
  whatsapp_number text
  evolution_instance_id text
  evolution_instance_token text
  is_online boolean DEFAULT false
  created_at timestamptz

-- Conversas capturadas
conversations
  id uuid PK
  owner_user_id uuid FK → users
  contact_number text           -- número do contato (+55...)
  contact_name text
  status enum('nao_salva','pendente','ativa','encerrada')
  source enum('pessoal','bot')
  municipality text
  trigger_keywords text[]
  last_message_at timestamptz
  last_synced_at timestamptz
  created_at timestamptz

-- Mensagens
messages
  id uuid PK
  conversation_id uuid FK → conversations
  direction enum('in','out')
  content text
  message_type enum('text','image','document','audio','video')
  media_url text
  evolution_message_id text UNIQUE
  sent_at timestamptz

-- Atendimentos
attendances
  id uuid PK
  conversation_id uuid FK → conversations
  assigned_to uuid FK → users
  status enum('aberto','em_andamento','transferido','encerrado')
  municipality text
  summary text                  -- resumo gerado pelo agente
  opened_at timestamptz
  closed_at timestamptz
  created_at timestamptz

-- Histórico de transferências
attendance_transfers
  id uuid PK
  attendance_id uuid FK → attendances
  from_user_id uuid FK → users
  to_user_id uuid FK → users
  note text
  transferred_at timestamptz

-- Arquivos de contexto gerados
context_files
  id uuid PK
  conversation_id uuid FK → conversations
  file_type enum('json','md','index')
  github_path text
  github_commit_sha text
  message_count int
  generated_at timestamptz
  status enum('success','error')
  error_message text

-- Config do bot oficial
bot_config
  id uuid PK (single row)
  is_active boolean
  instance_id text
  instance_token text
  provider enum('evolution_go','meta_cloud','twilio')
  welcome_message text
  delegate_by_municipality boolean
  auto_reply_after_hours boolean
  notify_on_delegation boolean
  updated_at timestamptz

-- Config de sync GitHub
github_sync_config
  id uuid PK (single row)
  is_active boolean
  repo text                     -- owner/repo
  branch text
  output_dir text
  pat_token text                -- criptografado
  generate_json boolean
  generate_md boolean
  generate_index boolean
  only_closed boolean
  sync_time time                -- ex: '02:00'
  file_prefix text
  last_sync_at timestamptz
  last_sync_status enum('success','error','pending')
  updated_at timestamptz

-- Config do agente IA
agent_config
  id uuid PK (single row)
  is_active boolean
  model text                    -- 'gpt-4o', 'claude-3-5-sonnet', etc.
  api_key text                  -- criptografado
  system_prompt text
  temperature numeric(3,2)
  suggest_replies boolean
  auto_summarize boolean
  updated_at timestamptz

-- Fontes RAG do agente
rag_sources
  id uuid PK
  type enum('github','supabase','drive','projex','enggov','webhook')
  name text
  config jsonb                  -- configuração específica por tipo
  is_active boolean
  last_sync_at timestamptz
  created_at timestamptz

-- Integrações externas
integrations
  id uuid PK
  type enum('supabase','drive','projex','enggov','github','custom')
  name text
  config jsonb                  -- api_key, url, etc. (criptografado)
  status enum('connected','disconnected','error')
  last_checked_at timestamptz
  created_at timestamptz
```

### Políticas RLS (Row-Level Security)

- `conversations`: funcionário vê apenas as suas; supervisor vê de todos os funcionários (não há modelo de sub-equipes — escopo flat); admin vê todas
- `messages`: herda da política de `conversations`
- `attendances`: idem
- `bot_config`, `github_sync_config`, `agent_config`: somente admin lê/escreve
- `users`: cada um lê o próprio; admin lê/escreve todos

---

## 6. Integrações externas

| Sistema | Uso | Status inicial |
|---|---|---|
| **Evolution Go** | Instâncias WhatsApp por funcionário + bot | Ativo (VPS) |
| **Supabase** | Banco principal + Auth + Realtime | Ativo |
| **GitHub** | Push diário de arquivos de contexto | Configurável |
| **Google Drive** | Fonte RAG para o agente | Opcional |
| **Projex** | Fonte RAG: projetos e obras dos municípios | Opcional |
| **EngGov** | Fonte RAG: orçamentos e contratos gov. | Opcional |
| **OpenAI / Anthropic** | Modelo do agente IA | Configurável |

---

## 7. Fluxo de transferência de atendimento

O WhatsApp é pessoal — não é possível mover tecnicamente a conversa de número.

**Fluxo definido:**
1. Funcionário A clica "Transferir" e seleciona Funcionário B + nota opcional
2. Sistema: cria registro em `attendance_transfers`, atualiza `assigned_to` no atendimento
3. Sistema: envia mensagem automática ao contato via Evolution Go de A: *"Seu atendimento foi transferido para [Nome de B]. Em breve entrarão em contato."*
4. Funcionário B recebe notificação push (WebSocket)
5. Funcionário B vê o histórico completo no sistema e inicia contato pelo seu próprio número
6. Nova conversa de B com o contato é vinculada ao mesmo atendimento

---

## 8. Fluxo de geração de contexto

```
Cron 02:00 (configurável)
  ↓
Busca conversas com last_message_at > last_synced_at
  ↓
Para cada conversa:
  Gera ammoc-conv-{id}.json
  Gera ammoc-conv-{id}.md
  Atualiza last_synced_at
  ↓
Atualiza index.md
  ↓
Git commit + push (via API GitHub)
  ↓
Registra em context_files (github_commit_sha, status)
  ↓
Notifica Admin via WebSocket
```

**Estrutura do `.json`:**
```json
{
  "id": "uuid",
  "contact": { "number": "+55...", "name": "..." },
  "municipality": "Capinzal",
  "attendance": { "id": "...", "opened_at": "...", "closed_at": "...", "summary": "..." },
  "messages": [ { "direction": "in|out", "content": "...", "sent_at": "..." } ],
  "keywords": ["obra", "contrato"],
  "generated_at": "..."
}
```

---

## 9. Responsividade e UX

- Desktop-first (1440px), responsivo até tablet (820px)
- Design system: tokens AMMOC (`system.css`) — verde `#2A8A3A`, Barlow + Inter
- Sidebar verde AMMOC (`#166331`), logo oficial
- Tema claro (papel `#FAF7F1`), superfícies brancas

---

## 10. Sequência de implementação

1. **Fase 1 — Fundação** (banco + auth + estrutura)
   - Schema Supabase (migrations)
   - NestJS boilerplate com módulos esqueleto
   - Next.js com layout base, design system AMMOC, autenticação

2. **Fase 2 — WhatsApp core**
   - WhatsAppModule: criar/deletar instâncias, QR code, webhook
   - ConversationModule: receber mensagens, persistir, listar
   - Tela Funcionário (dashboard + lista de conversas)

3. **Fase 3 — Atendimentos**
   - AttendanceModule: criar, transferir, encerrar
   - NotificationModule: WebSocket
   - Tela Atendimento (chat + ações)

4. **Fase 4 — Admin + Contexto**
   - AdminModule: dashboard, equipe
   - ContextModule: geração de arquivos + GitHub push
   - Tela Admin AMMOC

5. **Fase 5 — Bot + Agente IA**
   - BotModule: número oficial, delegação automática
   - AgentModule: RAG, sugestões, resumo automático
   - Tela Configurações completa

---

## 11. Decisões e justificativas

| Decisão | Escolha | Justificativa |
|---|---|---|
| Arquitetura | Modular Monolith | Equipe pequena, complexidade gerenciável, fácil refatorar depois |
| WhatsApp | Evolution Go (self-hosted) | Já rodando no VPS, sem custo extra, API limpa |
| Banco | Supabase | PostgreSQL gerenciado, Auth, RLS, Realtime nativos |
| Real-time | Socket.io | Mais simples que Supabase Realtime para eventos customizados |
| Transferência | Reassina no banco + msg automática | WhatsApp é pessoal; impossível mover canal tecnicamente |
| Contexto | Arquivos em GitHub | Fonte RAG universal, versionado, sem lock-in |
| Segredos | Criptografado no banco | `pat_token`, `api_key` — criptografia na camada de serviço |
