# Canal AMMOC — Design Spec

## Visão Geral

O Canal AMMOC é o sistema de atendimento centralizado da AMMOC via WhatsApp oficial
(Meta Business API). Cidadãos entram em contato pelo número oficial da AMMOC; um bot de
IA tenta responder automaticamente e, quando necessário, delega a conversa para o
funcionário correto com base no setor responsável pelo assunto.

O cidadão **sempre** se comunica com o número oficial da AMMOC. O funcionário recebe a
delegação no WhatsApp pessoal, responde normalmente, e o sistema intercepta essa
resposta para enviá-la ao cidadão pelo número da AMMOC. Tudo é registrado no CRM.

---

## Fluxo de Comunicação

```
Cidadão
  │
  │ WhatsApp → número AMMOC (Meta Business API)
  ↓
[Webhook Meta] → CanalWebhookController
  ↓
[BotService] — tenta responder com LLM + ferramentas
  ├─ Bot consegue responder
  │    └→ MetaService.send() → cidadão recebe do número AMMOC
  │
  └─ Bot delega para funcionário
       ├→ RoutingService.route() → identifica setor → escolha funcionário
       ├→ Cria canal_conversation delegada (assigned_to = funcionário)
       ├→ Notifica funcionário no WhatsApp pessoal via Evolution:
       │    "📋 [Nome do cidadão]: [resumo do assunto]"
       └→ Funcionário responde no WhatsApp pessoal
            ↓
           Evolution webhook captura a resposta
            ↓
           Sistema detecta que é conversa canal delegada
            ↓
           MetaService.send() → cidadão recebe do número AMMOC ✓
```

---

## Fases de Implementação

### Fase 1 — Infraestrutura + Inbox (sem IA)
Receber mensagens via Meta API, exibir no CRM, setores configuráveis, 
delegação manual por admin/supervisor.

### Fase 2 — Bot IA Configurável
LLM provider-agnóstico (configurable API key + model), roteamento automático
por setor baseado no conteúdo da mensagem, delegação automática.

### Fase 3 — Ferramentas do Bot + Bridge Evolution↔Meta
IngeGOV API (consultar andamento de projetos), Google Drive (buscar documentos),
interceptação de respostas do funcionário via Evolution para reenvio via Meta.

---

## Banco de Dados

### Novas tabelas

```sql
-- Setores/departamentos da organização
CREATE TABLE sectors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,                     -- "Engenharia Civil"
  description text,
  keywords    text[],                            -- ["obra","pavimento","esgoto"]
  created_at  timestamptz DEFAULT now()
);

-- Membros de cada setor (muitos-para-muitos com users)
CREATE TABLE sector_members (
  sector_id   uuid REFERENCES sectors(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id)   ON DELETE CASCADE,
  PRIMARY KEY (sector_id, user_id)
);

-- Configuração do canal Meta (singleton — uma linha por instalação)
CREATE TABLE canal_config (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meta_phone_number_id  text NOT NULL,
  meta_access_token     text NOT NULL,
  meta_verify_token     text NOT NULL,   -- token para validar webhook
  waba_id               text NOT NULL,   -- WhatsApp Business Account ID
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

-- Conversas no canal AMMOC (cidadão ↔ AMMOC)
CREATE TABLE canal_conversations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_contact_number text NOT NULL,     -- número do cidadão
  wa_contact_name   text,              -- nome (do perfil WhatsApp)
  sector_id         uuid REFERENCES sectors(id),
  assigned_to       uuid REFERENCES users(id),
  status            text NOT NULL DEFAULT 'bot',
    -- 'bot'    = sendo tratado pelo bot
    -- 'open'   = aguardando humano (delegado mas não atendido)
    -- 'human'  = em atendimento por funcionário
    -- 'closed' = encerrado
  created_at        timestamptz DEFAULT now(),
  last_message_at   timestamptz DEFAULT now()
);

-- Mensagens do canal AMMOC
CREATE TABLE canal_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES canal_conversations(id) ON DELETE CASCADE,
  direction       text NOT NULL, -- 'in' (cidadão) | 'out' (AMMOC)
  content         text NOT NULL,
  wa_message_id   text UNIQUE,   -- ID da mensagem no WhatsApp (dedup)
  sent_by         uuid REFERENCES users(id), -- null = bot/automático
  sent_at         timestamptz DEFAULT now()
);

-- Configuração do bot IA (singleton)
CREATE TABLE bot_config (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  llm_provider   text NOT NULL DEFAULT 'anthropic',
    -- 'anthropic' | 'openai' | 'google' | 'custom'
  llm_api_key    text NOT NULL DEFAULT '',
  llm_model      text NOT NULL DEFAULT 'claude-opus-4-5',
  system_prompt  text NOT NULL DEFAULT '',
  max_tokens     int  NOT NULL DEFAULT 1024,
  enabled        boolean NOT NULL DEFAULT false,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

-- Ferramentas disponíveis para o bot (Fase 3)
CREATE TABLE bot_tools (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_type   text NOT NULL,  -- 'inegov' | 'gdrive' | 'custom'
  name        text NOT NULL,
  description text,           -- descrição para o LLM entender quando usar
  config      jsonb,          -- credenciais/endpoints da ferramenta
  enabled     boolean NOT NULL DEFAULT false,
  created_at  timestamptz DEFAULT now()
);
```

### Índices importantes

```sql
CREATE INDEX idx_canal_conversations_status        ON canal_conversations(status);
CREATE INDEX idx_canal_conversations_assigned_to   ON canal_conversations(assigned_to);
CREATE INDEX idx_canal_messages_conversation_id    ON canal_messages(conversation_id);
CREATE INDEX idx_sector_members_user_id            ON sector_members(user_id);
```

---

## Módulos da API (NestJS)

### `canal` module — estrutura de arquivos

```
apps/api/src/modules/canal/
  canal.module.ts
  canal-webhook.controller.ts   ← recebe eventos do Meta
  canal-inbox.controller.ts     ← endpoints autenticados para o CRM
  meta.service.ts               ← envia mensagens via Meta Cloud API
  canal-conversation.service.ts ← CRUD de conversas e mensagens
  bot.service.ts                ← orquestra LLM + ferramentas (Fase 2)
  routing.service.ts            ← decide setor/funcionário (Fase 2)
  llm/
    llm.interface.ts            ← interface abstrata do LLM
    anthropic.provider.ts
    openai.provider.ts
    llm-factory.service.ts      ← instancia o provider certo
  tools/
    tool.interface.ts           ← interface abstrata de ferramenta
    inegov.tool.ts              ← consulta projetos IngeGOV (Fase 3)
    gdrive.tool.ts              ← busca no Drive (Fase 3)
    tools-registry.service.ts
```

### `sectors` module — estrutura

```
apps/api/src/modules/sectors/
  sectors.module.ts
  sectors.controller.ts  ← CRUD de setores + membros
  sectors.service.ts
```

### Endpoints principais

```
# Webhook Meta (público — validado pelo verify_token)
GET  /api/canal/webhook          ← validação inicial do webhook
POST /api/canal/webhook          ← recebe eventos de mensagens

# Canal inbox (autenticado)
GET  /api/canal/conversations           ← lista conversas
GET  /api/canal/conversations/:id       ← detalhes + mensagens
POST /api/canal/conversations/:id/assign ← delegar manualmente
POST /api/canal/conversations/:id/message ← enviar mensagem (funcionário via CRM)
POST /api/canal/conversations/:id/close  ← encerrar conversa

# Configuração (admin)
GET  /api/canal/config           ← lê configuração Meta
PUT  /api/canal/config           ← salva phone_number_id, access_token, etc.
GET  /api/canal/bot-config       ← lê configuração do bot
PUT  /api/canal/bot-config       ← salva LLM provider, api_key, model, prompt
GET  /api/canal/bot-tools        ← lista ferramentas
PUT  /api/canal/bot-tools/:id    ← ativa/configura ferramenta

# Setores (admin)
GET    /api/sectors               ← lista setores
POST   /api/sectors               ← criar setor
PUT    /api/sectors/:id           ← editar setor
DELETE /api/sectors/:id           ← remover setor
POST   /api/sectors/:id/members   ← adicionar funcionário ao setor
DELETE /api/sectors/:id/members/:userId ← remover funcionário
```

---

## Frontend — Novas telas

### Sidebar — seção "Canal AMMOC" (admin/supervisor apenas)

```
CANAL AMMOC
  📡  Inbox AMMOC     /canal
  ⚙️  Configurações   /canal/config
```

### `/canal` — Inbox do canal AMMOC

Layout de duas colunas estilo WhatsApp Web:
- **Coluna esquerda:** lista de conversas (cidadão, status, setor, último msg, hora)
- **Coluna direita:** conversa aberta — histórico de mensagens + campo de resposta

Filtros: Todas | Bot | Aguardando | Em atendimento | Encerradas  
Ações por conversa: Delegar a setor/funcionário | Encerrar | Ver histórico

### `/canal/config` — Configuração do canal (admin)

Seção **Conexão Meta:**
- Phone Number ID, Access Token, Verify Token, WABA ID
- Botão "Testar conexão"
- Instrução passo a passo para configurar o webhook no portal Meta

Seção **Bot IA:**
- Toggle "Bot ativo/inativo"
- Provider: Anthropic | OpenAI | Google | Custom
- API Key (campo senha)
- Modelo (dropdown ou texto livre)
- System Prompt (textarea)
- Max tokens

Seção **Ferramentas do Bot** (Fase 3):
- IngeGOV: URL base + credenciais
- Google Drive: OAuth / Service Account JSON

### `/configuracoes/setores` — Gestão de setores

Tabela de setores com:
- Nome, descrição, palavras-chave, nº de membros
- Botão editar/remover

Modal de criação/edição:
- Nome*, Descrição, Palavras-chave (tags), Membros (multi-select de funcionários)

### Perfil do usuário — campo Setor

Na tela de edição de perfil (`/configuracoes`) e na listagem de equipe (`/equipe`):
- Campo "Setor" (dropdown de setores existentes)
- Um funcionário pode pertencer a mais de um setor

---

## Lógica de Roteamento — Fase 2

```
1. Mensagem chega do cidadão
2. Bot LLM classifica o assunto (usando system_prompt + keywords dos setores)
3. BotService decide:
   a. Pode responder com ferramentas? → responde, registra
   b. Precisa de humano? → RoutingService.route(conversation)
4. RoutingService:
   a. Extrai intenção da última mensagem
   b. Compara com keywords de cada setor
   c. Escolhe setor com maior score
   d. Dentro do setor, escolhe funcionário disponível
      (critério: online recente, menor carga de atendimentos abertos)
   e. Cria delegação e notifica funcionário via Evolution
```

---

## Bridge Evolution ↔ Meta — Fase 3

Quando um funcionário responde via WhatsApp pessoal:

1. Evolution webhook recebe a mensagem do funcionário
2. `WebhookService.handleMessage()` detecta que o remetente é um funcionário
   (`remoteJid` corresponde a algum `users.whatsapp_number`)
3. Verifica se a mensagem é uma resposta a uma delegação canal ativa:
   - Busca `canal_conversations` com `assigned_to = funcionário.id` e `status = 'human'`
   - Verifica se o `contact_number` da última mensagem canal corresponde
4. Se sim → `MetaService.sendMessage(canal_config, cidadão_number, texto)` → 
   cidadão recebe pelo número AMMOC
5. Registra a mensagem em `canal_messages` com `sent_by = funcionário.id`

---

## Configuração Meta Business API — Guia (manual, feito pelo admin)

1. Acessar **developers.facebook.com** → criar App → tipo "Business"
2. Adicionar produto **WhatsApp**
3. Em WhatsApp → Getting Started: copiar **Phone Number ID** e **WABA ID**
4. Gerar **Permanent Access Token** (via System User no Business Manager)
5. Em WhatsApp → Configuration → Webhook:
   - URL: `https://api.crm.ammoc.org.br/api/canal/webhook`
   - Verify Token: valor definido no `canal_config`
   - Subscribe: `messages`
6. Adicionar número de telefone real (precisa de verificação Meta)
7. Salvar credenciais no `/canal/config` do CRM

---

## Segurança

- O `meta_access_token` e `llm_api_key` são armazenados criptografados no DB (via `pgcrypto` ou variável de ambiente de chave de criptografia)
- O webhook Meta valida a assinatura `X-Hub-Signature-256` em cada requisição
- Apenas usuários com role `admin` ou `supervisor` acessam `/canal/config` e `/configuracoes/setores`
- O inbox `/canal` é visível para admin/supervisor; funcionários só veem conversas delegadas a eles

---

## Fora do Escopo (decisão YAGNI)

- Templates de mensagem Meta (HSM) — não necessário inicialmente
- Mensagens de mídia/áudio — Fase futura
- Múltiplos números AMMOC — uma configuração por instalação
- Analytics/relatórios do canal — Fase futura
- App mobile — fora do escopo

---

## Resumo das Dependências Externas

| Sistema | Fase | Como integrar |
|---------|------|---------------|
| Meta Business API | 1 | REST API Cloud API v17+ |
| LLM (Anthropic/OpenAI/etc.) | 2 | REST via provider SDK |
| Evolution (funcionários) | 1 | já existe no sistema |
| IngeGOV | 3 | REST API (credenciais a definir) |
| Google Drive | 3 | Google Drive API v3 + Service Account |
