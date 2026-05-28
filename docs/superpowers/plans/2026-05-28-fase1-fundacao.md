# CRMWhats Fase 1 — Fundação: Monorepo, Schema, Auth, Shell

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monorepo pnpm funcional com NestJS API + Next.js web + Supabase schema completo + autenticação + shell visual AMMOC. Ao final desta fase: login funcional, usuário autenticado, sidebar AMMOC renderizando, schema no banco.

**Architecture:** Monorepo pnpm workspaces. NestJS (porta 3001) verifica tokens Supabase Auth via `supabase.auth.getUser()`. Next.js (porta 3000) usa `@supabase/ssr` para auth no servidor. Tipos compartilhados em `packages/types`.

**Tech Stack:** Node 24, pnpm 10, NestJS 11, Next.js 15, TypeScript 5, Supabase JS v2, CSS Modules, Jest

---

## Estrutura de arquivos criada neste plano

```
GERENCIAMENTO WHATSAPP/           ← raiz do workspace
├── apps/
│   ├── api/                      ← NestJS backend
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── app.controller.ts
│   │   │   ├── config/
│   │   │   │   └── configuration.ts
│   │   │   └── modules/
│   │   │       ├── auth/
│   │   │       │   ├── auth.module.ts
│   │   │       │   ├── auth.guard.ts
│   │   │       │   ├── current-user.decorator.ts
│   │   │       │   └── supabase-admin.service.ts
│   │   │       └── users/
│   │   │           ├── users.module.ts
│   │   │           ├── users.service.ts
│   │   │           ├── users.controller.ts
│   │   │           └── dto/update-profile.dto.ts
│   │   ├── test/
│   │   │   ├── auth.guard.spec.ts
│   │   │   └── users.service.spec.ts
│   │   ├── .env.example
│   │   ├── nest-cli.json
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── web/                      ← Next.js frontend
│       ├── src/
│       │   ├── app/
│       │   │   ├── layout.tsx
│       │   │   ├── page.tsx
│       │   │   ├── (auth)/
│       │   │   │   ├── layout.tsx
│       │   │   │   └── login/page.tsx
│       │   │   └── (app)/
│       │   │       ├── layout.tsx
│       │   │       └── dashboard/page.tsx
│       │   ├── components/
│       │   │   ├── layout/
│       │   │   │   ├── AppShell.tsx
│       │   │   │   ├── AppShell.module.css
│       │   │   │   ├── Sidebar.tsx
│       │   │   │   └── Sidebar.module.css
│       │   │   └── ui/
│       │   │       ├── Button.tsx
│       │   │       └── Button.module.css
│       │   ├── lib/
│       │   │   └── supabase/
│       │   │       ├── client.ts
│       │   │       └── server.ts
│       │   └── styles/
│       │       ├── ammoc.css
│       │       └── globals.css
│       ├── middleware.ts
│       ├── next.config.ts
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   └── types/
│       ├── src/index.ts
│       ├── package.json
│       └── tsconfig.json
├── supabase/
│   └── migrations/
│       └── 20260528000001_initial_schema.sql
├── package.json                  ← pnpm workspace root
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

---

## Task 1: Inicializar repositório e monorepo

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`

- [ ] **Step 1.1: Git init**

```bash
cd "C:\Users\max_m\OneDrive\Área de Trabalho\GERENCIAMENTO WHATSAPP"
git init
git add .gitignore
git commit -m "chore: initial commit with gitignore"
```

Expected: repositório git inicializado, commit com `.gitignore`.

- [ ] **Step 1.2: Criar raiz do workspace**

Criar `package.json` na raiz:

```json
{
  "name": "ammoc-crmwhats",
  "private": true,
  "version": "0.1.0",
  "engines": { "node": ">=20", "pnpm": ">=9" },
  "scripts": {
    "dev": "pnpm --parallel dev",
    "dev:api": "pnpm --filter @crmwhats/api dev",
    "dev:web": "pnpm --filter @crmwhats/web dev",
    "build": "pnpm --filter @crmwhats/types build && pnpm --parallel --filter !@crmwhats/types build",
    "test": "pnpm --parallel test",
    "test:api": "pnpm --filter @crmwhats/api test"
  }
}
```

- [ ] **Step 1.3: Criar pnpm-workspace.yaml**

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

- [ ] **Step 1.4: Criar tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 1.5: Criar diretórios**

```bash
mkdir apps\api apps\web packages\types supabase\migrations
```

- [ ] **Step 1.6: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json
git commit -m "chore: monorepo workspace setup"
```

---

## Task 2: Pacote de tipos compartilhados

**Files:**
- Create: `packages/types/package.json`
- Create: `packages/types/tsconfig.json`
- Create: `packages/types/src/index.ts`

- [ ] **Step 2.1: Criar package.json do pacote de tipos**

```json
{
  "name": "@crmwhats/types",
  "version": "0.1.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "devDependencies": {
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 2.2: Criar tsconfig.json do pacote**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "CommonJS",
    "moduleResolution": "Node"
  },
  "include": ["src"]
}
```

- [ ] **Step 2.3: Criar src/index.ts com todos os tipos do domínio**

```typescript
// packages/types/src/index.ts

export type UserRole = 'funcionario' | 'supervisor' | 'admin';

export type ConversationStatus = 'nao_salva' | 'pendente' | 'ativa' | 'encerrada';
export type ConversationSource = 'pessoal' | 'bot';

export type AttendanceStatus = 'aberto' | 'em_andamento' | 'transferido' | 'encerrado';

export type MessageDirection = 'in' | 'out';
export type MessageType = 'text' | 'image' | 'document' | 'audio' | 'video';

export type ContextFileType = 'json' | 'md' | 'index';
export type SyncStatus = 'success' | 'error' | 'pending';

export type BotProvider = 'evolution_go' | 'meta_cloud' | 'twilio';

export type IntegrationType = 'supabase' | 'drive' | 'projex' | 'enggov' | 'github' | 'custom';
export type IntegrationStatus = 'connected' | 'disconnected' | 'error';

export type RagSourceType = 'github' | 'supabase' | 'drive' | 'projex' | 'enggov' | 'webhook';

// ── Core entities ──────────────────────────────────────

export interface AppUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  whatsapp_number: string | null;
  evolution_instance_id: string | null;
  evolution_instance_token: string | null;
  is_online: boolean;
  created_at: string;
}

export interface Conversation {
  id: string;
  owner_user_id: string;
  contact_number: string;
  contact_name: string;
  status: ConversationStatus;
  source: ConversationSource;
  municipality: string | null;
  trigger_keywords: string[];
  last_message_at: string | null;
  last_synced_at: string | null;
  created_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  direction: MessageDirection;
  content: string;
  message_type: MessageType;
  media_url: string | null;
  evolution_message_id: string | null;
  sent_at: string;
}

export interface Attendance {
  id: string;
  conversation_id: string;
  assigned_to: string;
  status: AttendanceStatus;
  municipality: string | null;
  summary: string | null;
  opened_at: string;
  closed_at: string | null;
  created_at: string;
}

export interface AttendanceTransfer {
  id: string;
  attendance_id: string;
  from_user_id: string;
  to_user_id: string;
  note: string | null;
  transferred_at: string;
}

export interface ContextFile {
  id: string;
  conversation_id: string;
  file_type: ContextFileType;
  github_path: string | null;
  github_commit_sha: string | null;
  message_count: number;
  generated_at: string;
  status: SyncStatus;
  error_message: string | null;
}

// ── DTOs usados em API responses ───────────────────────

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
  attendance: Attendance | null;
}

export interface AttendanceWithDetails extends Attendance {
  conversation: Conversation;
  assigned_user: AppUser;
  transfers: AttendanceTransfer[];
}

// ── API generic types ──────────────────────────────────

export interface ApiResponse<T> {
  data: T;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}
```

- [ ] **Step 2.4: Instalar dependências e fazer build**

```bash
cd "C:\Users\max_m\OneDrive\Área de Trabalho\GERENCIAMENTO WHATSAPP"
pnpm --filter @crmwhats/types install
pnpm --filter @crmwhats/types build
```

Expected: `packages/types/dist/` criado com arquivos `.js` e `.d.ts`.

- [ ] **Step 2.5: Commit**

```bash
git add packages/
git commit -m "feat(types): add shared domain types"
```

---

## Task 3: Migration do banco Supabase

**Files:**
- Create: `supabase/migrations/20260528000001_initial_schema.sql`

- [ ] **Step 3.1: Escrever a migration completa**

Criar `supabase/migrations/20260528000001_initial_schema.sql`:

```sql
-- CRMWhats — Schema inicial
-- Projeto: xfqphbdurynuwvrnxpvj

-- ── Extensões ────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Tipos enum ───────────────────────────────────────────
CREATE TYPE user_role AS ENUM ('funcionario', 'supervisor', 'admin');
CREATE TYPE conversation_status AS ENUM ('nao_salva', 'pendente', 'ativa', 'encerrada');
CREATE TYPE conversation_source AS ENUM ('pessoal', 'bot');
CREATE TYPE attendance_status AS ENUM ('aberto', 'em_andamento', 'transferido', 'encerrado');
CREATE TYPE message_direction AS ENUM ('in', 'out');
CREATE TYPE message_type AS ENUM ('text', 'image', 'document', 'audio', 'video');
CREATE TYPE context_file_type AS ENUM ('json', 'md', 'index');
CREATE TYPE sync_status AS ENUM ('success', 'error', 'pending');
CREATE TYPE bot_provider AS ENUM ('evolution_go', 'meta_cloud', 'twilio');
CREATE TYPE integration_type AS ENUM ('supabase', 'drive', 'projex', 'enggov', 'github', 'custom');
CREATE TYPE integration_status AS ENUM ('connected', 'disconnected', 'error');
CREATE TYPE rag_source_type AS ENUM ('github', 'supabase', 'drive', 'projex', 'enggov', 'webhook');

-- ── Tabela users ─────────────────────────────────────────
CREATE TABLE public.users (
  id          uuid REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email       text NOT NULL,
  name        text NOT NULL,
  role        user_role NOT NULL DEFAULT 'funcionario',
  whatsapp_number          text,
  evolution_instance_id    text,
  evolution_instance_token text,
  is_online   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Auto-cria row em public.users ao novo sign-up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.users (id, email, name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── Tabela conversations ──────────────────────────────────
CREATE TABLE public.conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  contact_number   text NOT NULL,
  contact_name     text NOT NULL DEFAULT '',
  status           conversation_status NOT NULL DEFAULT 'nao_salva',
  source           conversation_source NOT NULL DEFAULT 'pessoal',
  municipality     text,
  trigger_keywords text[] NOT NULL DEFAULT '{}',
  last_message_at  timestamptz,
  last_synced_at   timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversations_owner ON public.conversations(owner_user_id);
CREATE INDEX idx_conversations_status ON public.conversations(status);
CREATE INDEX idx_conversations_last_msg ON public.conversations(last_message_at DESC);

-- ── Tabela messages ───────────────────────────────────────
CREATE TABLE public.messages (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id       uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  direction             message_direction NOT NULL,
  content               text NOT NULL DEFAULT '',
  message_type          message_type NOT NULL DEFAULT 'text',
  media_url             text,
  evolution_message_id  text UNIQUE,
  sent_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_conversation ON public.messages(conversation_id, sent_at);

-- ── Tabela attendances ────────────────────────────────────
CREATE TABLE public.attendances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  assigned_to     uuid NOT NULL REFERENCES public.users(id),
  status          attendance_status NOT NULL DEFAULT 'aberto',
  municipality    text,
  summary         text,
  opened_at       timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_attendances_assigned ON public.attendances(assigned_to);
CREATE INDEX idx_attendances_status ON public.attendances(status);

-- ── Tabela attendance_transfers ───────────────────────────
CREATE TABLE public.attendance_transfers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id   uuid NOT NULL REFERENCES public.attendances(id) ON DELETE CASCADE,
  from_user_id    uuid NOT NULL REFERENCES public.users(id),
  to_user_id      uuid NOT NULL REFERENCES public.users(id),
  note            text,
  transferred_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Tabela context_files ──────────────────────────────────
CREATE TABLE public.context_files (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  file_type         context_file_type NOT NULL,
  github_path       text,
  github_commit_sha text,
  message_count     integer NOT NULL DEFAULT 0,
  generated_at      timestamptz NOT NULL DEFAULT now(),
  status            sync_status NOT NULL DEFAULT 'pending',
  error_message     text
);

-- ── Tabela bot_config (single row) ───────────────────────
CREATE TABLE public.bot_config (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  is_active                boolean NOT NULL DEFAULT false,
  instance_id              text,
  instance_token           text,
  provider                 bot_provider NOT NULL DEFAULT 'evolution_go',
  welcome_message          text NOT NULL DEFAULT 'Olá! Você entrou em contato com a AMMOC. Em breve retornaremos.',
  delegate_by_municipality boolean NOT NULL DEFAULT true,
  auto_reply_after_hours   boolean NOT NULL DEFAULT true,
  notify_on_delegation     boolean NOT NULL DEFAULT true,
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- ── Tabela github_sync_config (single row) ───────────────
CREATE TABLE public.github_sync_config (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  is_active          boolean NOT NULL DEFAULT false,
  repo               text NOT NULL DEFAULT '',
  branch             text NOT NULL DEFAULT 'main',
  output_dir         text NOT NULL DEFAULT 'context/',
  pat_token          text NOT NULL DEFAULT '',
  generate_json      boolean NOT NULL DEFAULT true,
  generate_md        boolean NOT NULL DEFAULT true,
  generate_index     boolean NOT NULL DEFAULT true,
  only_closed        boolean NOT NULL DEFAULT false,
  sync_time          time NOT NULL DEFAULT '02:00',
  file_prefix        text NOT NULL DEFAULT 'ammoc-conv-',
  last_sync_at       timestamptz,
  last_sync_status   sync_status,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- ── Tabela agent_config (single row) ─────────────────────
CREATE TABLE public.agent_config (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  is_active        boolean NOT NULL DEFAULT false,
  model            text NOT NULL DEFAULT 'gpt-4o',
  api_key          text NOT NULL DEFAULT '',
  system_prompt    text NOT NULL DEFAULT 'Você é o assistente oficial da AMMOC.',
  temperature      numeric(3,2) NOT NULL DEFAULT 0.30,
  suggest_replies  boolean NOT NULL DEFAULT true,
  auto_summarize   boolean NOT NULL DEFAULT true,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ── Tabela rag_sources ────────────────────────────────────
CREATE TABLE public.rag_sources (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type         rag_source_type NOT NULL,
  name         text NOT NULL,
  config       jsonb NOT NULL DEFAULT '{}',
  is_active    boolean NOT NULL DEFAULT true,
  last_sync_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── Tabela integrations ───────────────────────────────────
CREATE TABLE public.integrations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type             integration_type NOT NULL,
  name             text NOT NULL,
  config           jsonb NOT NULL DEFAULT '{}',
  status           integration_status NOT NULL DEFAULT 'disconnected',
  last_checked_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ── RLS ───────────────────────────────────────────────────
ALTER TABLE public.users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendances          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.context_files        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_config           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_sync_config   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_config         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rag_sources          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integrations         ENABLE ROW LEVEL SECURITY;

-- Helper: retorna role do usuário autenticado
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS user_role LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$;

-- users: cada um lê/atualiza o próprio; admin vê todos
CREATE POLICY "users_select_own" ON public.users FOR SELECT
  USING (id = auth.uid() OR public.current_user_role() IN ('supervisor', 'admin'));

CREATE POLICY "users_update_own" ON public.users FOR UPDATE
  USING (id = auth.uid());

CREATE POLICY "users_admin_all" ON public.users FOR ALL
  USING (public.current_user_role() = 'admin');

-- conversations: owner ou supervisor/admin
CREATE POLICY "conversations_select" ON public.conversations FOR SELECT
  USING (owner_user_id = auth.uid() OR public.current_user_role() IN ('supervisor', 'admin'));

CREATE POLICY "conversations_insert_own" ON public.conversations FOR INSERT
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY "conversations_update_own" ON public.conversations FOR UPDATE
  USING (owner_user_id = auth.uid() OR public.current_user_role() IN ('supervisor', 'admin'));

-- messages: herda escopo da conversa
CREATE POLICY "messages_select" ON public.messages FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_id
    AND (c.owner_user_id = auth.uid() OR public.current_user_role() IN ('supervisor', 'admin'))
  ));

CREATE POLICY "messages_insert" ON public.messages FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_id AND c.owner_user_id = auth.uid()
  ));

-- attendances: assigned_to ou supervisor/admin
CREATE POLICY "attendances_select" ON public.attendances FOR SELECT
  USING (assigned_to = auth.uid() OR public.current_user_role() IN ('supervisor', 'admin'));

CREATE POLICY "attendances_insert" ON public.attendances FOR INSERT
  WITH CHECK (assigned_to = auth.uid() OR public.current_user_role() IN ('supervisor', 'admin'));

CREATE POLICY "attendances_update" ON public.attendances FOR UPDATE
  USING (assigned_to = auth.uid() OR public.current_user_role() IN ('supervisor', 'admin'));

-- transfers: participante ou supervisor/admin
CREATE POLICY "transfers_select" ON public.attendance_transfers FOR SELECT
  USING (from_user_id = auth.uid() OR to_user_id = auth.uid()
    OR public.current_user_role() IN ('supervisor', 'admin'));

CREATE POLICY "transfers_insert" ON public.attendance_transfers FOR INSERT
  WITH CHECK (from_user_id = auth.uid() OR public.current_user_role() = 'admin');

-- context_files: supervisor+ pode ver todos
CREATE POLICY "context_files_select" ON public.context_files FOR SELECT
  USING (public.current_user_role() IN ('supervisor', 'admin'));

-- config tables: somente admin
CREATE POLICY "bot_config_admin" ON public.bot_config FOR ALL
  USING (public.current_user_role() = 'admin');

CREATE POLICY "github_sync_admin" ON public.github_sync_config FOR ALL
  USING (public.current_user_role() = 'admin');

CREATE POLICY "agent_config_admin" ON public.agent_config FOR ALL
  USING (public.current_user_role() = 'admin');

CREATE POLICY "rag_sources_admin" ON public.rag_sources FOR ALL
  USING (public.current_user_role() = 'admin');

CREATE POLICY "integrations_admin" ON public.integrations FOR ALL
  USING (public.current_user_role() = 'admin');
```

- [ ] **Step 3.2: Aplicar migration no Supabase via MCP**

Usar a ferramenta `mcp__supabase__apply_migration` com o conteúdo do arquivo acima.

(Se executando via Bash/CLI alternativo):
```bash
# Alternativa via supabase CLI (se instalado):
# npx supabase db push --project-ref xfqphbdurynuwvrnxpvj
```

- [ ] **Step 3.3: Verificar tabelas criadas**

Usar `mcp__supabase__list_tables` e confirmar que todas as 11 tabelas aparecem:
`users`, `conversations`, `messages`, `attendances`, `attendance_transfers`,
`context_files`, `bot_config`, `github_sync_config`, `agent_config`, `rag_sources`, `integrations`

- [ ] **Step 3.4: Commit da migration**

```bash
git add supabase/
git commit -m "feat(db): initial schema with RLS policies"
```

---

## Task 4: NestJS API — Bootstrap

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/nest-cli.json`
- Create: `apps/api/src/main.ts`
- Create: `apps/api/src/app.module.ts`
- Create: `apps/api/src/app.controller.ts`
- Create: `apps/api/src/config/configuration.ts`
- Create: `apps/api/.env.example`

- [ ] **Step 4.1: Criar package.json da API**

```json
{
  "name": "@crmwhats/api",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:cov": "jest --coverage"
  },
  "dependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@nestjs/config": "^4.0.0",
    "@nestjs/schedule": "^4.0.0",
    "@supabase/supabase-js": "^2.49.0",
    "@crmwhats/types": "workspace:*",
    "class-validator": "^0.14.0",
    "class-transformer": "^0.5.1",
    "reflect-metadata": "^0.2.0",
    "rxjs": "^7.8.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@nestjs/schematics": "^11.0.0",
    "@nestjs/testing": "^11.0.0",
    "@types/express": "^5.0.0",
    "@types/jest": "^29.5.0",
    "@types/node": "^22.0.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.0",
    "ts-node": "^10.9.0",
    "typescript": "^5.5.0"
  },
  "jest": {
    "moduleFileExtensions": ["js", "json", "ts"],
    "rootDir": "src",
    "testRegex": ".*\\.spec\\.ts$",
    "transform": { "^.+\\.(t|j)s$": "ts-jest" },
    "collectCoverageFrom": ["**/*.(t|j)s"],
    "coverageDirectory": "../coverage",
    "testEnvironment": "node",
    "moduleNameMapper": {
      "^@crmwhats/types$": "<rootDir>/../../packages/types/src/index.ts"
    }
  }
}
```

- [ ] **Step 4.2: Criar tsconfig.json da API**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "Node",
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "paths": {
      "@crmwhats/types": ["../../packages/types/src/index.ts"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4.3: Criar nest-cli.json**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
```

- [ ] **Step 4.4: Criar .env.example**

```env
# Supabase
SUPABASE_URL=https://xfqphbdurynuwvrnxpvj.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# App
PORT=3001
FRONTEND_URL=http://localhost:3000

# Evolution Go
EVOLUTION_URL=http://your-evolution-host:8085
EVOLUTION_API_KEY=your_evolution_api_key_here
```

Copiar para `.env`:
```bash
cp apps/api/.env.example apps/api/.env
```

**Preencher `SUPABASE_SERVICE_ROLE_KEY`:** buscar em https://supabase.com/dashboard/project/xfqphbdurynuwvrnxpvj/settings/api → "service_role" key.

- [ ] **Step 4.5: Criar config/configuration.ts**

```typescript
// apps/api/src/config/configuration.ts
export default () => ({
  port: parseInt(process.env.PORT ?? '3001', 10),
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  supabase: {
    url: process.env.SUPABASE_URL ?? '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  },
  evolution: {
    url: process.env.EVOLUTION_URL ?? 'http://2.25.139.166:8085',
    apiKey: process.env.EVOLUTION_API_KEY ?? '',
  },
});
```

- [ ] **Step 4.6: Criar app.controller.ts (health check)**

```typescript
// apps/api/src/app.controller.ts
import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('health')
  health(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
```

- [ ] **Step 4.7: Criar app.module.ts**

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import configuration from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
  ],
  controllers: [AppController],
})
export class AppModule {}
```

- [ ] **Step 4.8: Criar main.ts**

```typescript
// apps/api/src/main.ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    credentials: true,
  });

  const config = app.get(ConfigService);
  const port = config.get<number>('port') ?? 3001;

  await app.listen(port);
  console.log(`API running on http://localhost:${port}/api`);
}

bootstrap();
```

- [ ] **Step 4.9: Instalar dependências e testar**

```bash
cd "C:\Users\max_m\OneDrive\Área de Trabalho\GERENCIAMENTO WHATSAPP"
pnpm install
pnpm --filter @crmwhats/api dev
```

Em outro terminal:
```bash
curl http://localhost:3001/api/health
```

Expected: `{"status":"ok","timestamp":"2026-..."}` com status 200.

Parar o servidor (Ctrl+C).

- [ ] **Step 4.10: Commit**

```bash
git add apps/api/
git commit -m "feat(api): NestJS bootstrap with health check"
```

---

## Task 5: AuthModule — Guard Supabase JWT

**Files:**
- Create: `apps/api/src/modules/auth/supabase-admin.service.ts`
- Create: `apps/api/src/modules/auth/auth.guard.ts`
- Create: `apps/api/src/modules/auth/current-user.decorator.ts`
- Create: `apps/api/src/modules/auth/auth.module.ts`
- Create: `apps/api/src/modules/auth/auth.guard.spec.ts`

- [ ] **Step 5.1: Escrever o teste do guard (TDD)**

Criar `apps/api/src/modules/auth/auth.guard.spec.ts`:

```typescript
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { SupabaseAdminService } from './supabase-admin.service';

const mockSupabaseAdmin = {
  getUser: jest.fn(),
};

const makeContext = (authHeader?: string): ExecutionContext => ({
  switchToHttp: () => ({
    getRequest: () => ({
      headers: authHeader ? { authorization: authHeader } : {},
    }),
  }),
} as unknown as ExecutionContext);

describe('AuthGuard', () => {
  let guard: AuthGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new AuthGuard(mockSupabaseAdmin as unknown as SupabaseAdminService);
  });

  it('throws UnauthorizedException when no Authorization header', async () => {
    const ctx = makeContext();
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when token is invalid', async () => {
    mockSupabaseAdmin.getUser.mockResolvedValue({ data: { user: null }, error: new Error('invalid') });
    const ctx = makeContext('Bearer bad-token');
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('returns true and attaches user when token is valid', async () => {
    const fakeUser = { id: 'uuid-123', email: 'test@ammoc.org.br' };
    mockSupabaseAdmin.getUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer valid-token' } };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(req.user).toEqual(fakeUser);
    expect(mockSupabaseAdmin.getUser).toHaveBeenCalledWith('valid-token');
  });
});
```

- [ ] **Step 5.2: Rodar o teste e confirmar FAIL**

```bash
pnpm --filter @crmwhats/api test -- --testPathPattern=auth.guard
```

Expected: FAIL com "Cannot find module './auth.guard'"

- [ ] **Step 5.3: Criar SupabaseAdminService**

```typescript
// apps/api/src/modules/auth/supabase-admin.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseAdminService {
  private client: SupabaseClient;

  constructor(private config: ConfigService) {
    this.client = createClient(
      this.config.get<string>('supabase.url') ?? '',
      this.config.get<string>('supabase.serviceRoleKey') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }

  async getUser(token: string) {
    return this.client.auth.getUser(token);
  }
}
```

- [ ] **Step 5.4: Criar AuthGuard**

```typescript
// apps/api/src/modules/auth/auth.guard.ts
import {
  CanActivate, ExecutionContext, Injectable, UnauthorizedException,
} from '@nestjs/common';
import { SupabaseAdminService } from './supabase-admin.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private supabaseAdmin: SupabaseAdminService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Record<string, unknown> & {
      headers: Record<string, string>; user?: unknown;
    }>();

    const authHeader = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Bearer token');
    }

    const token = authHeader.slice(7);
    const { data, error } = await this.supabaseAdmin.getUser(token);

    if (error || !data.user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    request.user = data.user;
    return true;
  }
}
```

- [ ] **Step 5.5: Criar decorator @CurrentUser**

```typescript
// apps/api/src/modules/auth/current-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { User } from '@supabase/supabase-js';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): User => {
    const request = ctx.switchToHttp().getRequest<{ user: User }>();
    return request.user;
  },
);
```

- [ ] **Step 5.6: Criar AuthModule**

```typescript
// apps/api/src/modules/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { SupabaseAdminService } from './supabase-admin.service';
import { AuthGuard } from './auth.guard';

@Module({
  providers: [SupabaseAdminService, AuthGuard],
  exports: [SupabaseAdminService, AuthGuard],
})
export class AuthModule {}
```

- [ ] **Step 5.7: Rodar os testes e confirmar PASS**

```bash
pnpm --filter @crmwhats/api test -- --testPathPattern=auth.guard
```

Expected: `Tests: 3 passed`

- [ ] **Step 5.8: Registrar AuthModule no AppModule**

Editar `apps/api/src/app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AuthModule } from './modules/auth/auth.module';
import configuration from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    AuthModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
```

- [ ] **Step 5.9: Commit**

```bash
git add apps/api/src/modules/auth/
git commit -m "feat(api): AuthGuard with Supabase JWT verification"
```

---

## Task 6: UsersModule

**Files:**
- Create: `apps/api/src/modules/users/users.service.ts`
- Create: `apps/api/src/modules/users/users.controller.ts`
- Create: `apps/api/src/modules/users/users.module.ts`
- Create: `apps/api/src/modules/users/dto/update-profile.dto.ts`
- Create: `apps/api/src/modules/users/users.service.spec.ts`

- [ ] **Step 6.1: Escrever testes do UsersService (TDD)**

Criar `apps/api/src/modules/users/users.service.spec.ts`:

```typescript
import { UsersService } from './users.service';

const mockSupabase = {
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  order: jest.fn().mockReturnThis(),
  single: jest.fn(),
  update: jest.fn().mockReturnThis(),
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UsersService(mockSupabase as never);
  });

  it('findById returns user data', async () => {
    const fakeUser = { id: 'uuid-1', email: 'test@ammoc.org.br', name: 'Test', role: 'funcionario' };
    mockSupabase.single.mockResolvedValue({ data: fakeUser, error: null });

    const result = await service.findById('uuid-1');
    expect(result).toEqual(fakeUser);
    expect(mockSupabase.from).toHaveBeenCalledWith('users');
  });

  it('findById throws when user not found', async () => {
    mockSupabase.single.mockResolvedValue({ data: null, error: { message: 'not found' } });
    await expect(service.findById('bad-id')).rejects.toThrow('Usuário não encontrado');
  });

  it('updateProfile returns updated user', async () => {
    const updated = { id: 'uuid-1', name: 'Novo Nome' };
    mockSupabase.single.mockResolvedValue({ data: updated, error: null });

    const result = await service.updateProfile('uuid-1', { name: 'Novo Nome' });
    expect(result).toEqual(updated);
  });
});
```

- [ ] **Step 6.2: Rodar teste e confirmar FAIL**

```bash
pnpm --filter @crmwhats/api test -- --testPathPattern=users.service
```

Expected: FAIL com "Cannot find module './users.service'"

- [ ] **Step 6.3: Criar UpdateProfileDto**

```typescript
// apps/api/src/modules/users/dto/update-profile.dto.ts
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  whatsapp_number?: string;
}
```

- [ ] **Step 6.4: Criar UsersService**

```typescript
// apps/api/src/modules/users/users.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import type { AppUser } from '@crmwhats/types';
import type { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(private readonly supabase: SupabaseClient) {}

  async findById(id: string): Promise<AppUser> {
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) throw new NotFoundException('Usuário não encontrado');
    return data as AppUser;
  }

  async findAll(): Promise<AppUser[]> {
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .order('name');

    if (error) throw new Error(error.message);
    return (data ?? []) as AppUser[];
  }

  async updateProfile(id: string, dto: UpdateProfileDto): Promise<AppUser> {
    const { data, error } = await this.supabase
      .from('users')
      .update(dto)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) throw new NotFoundException('Usuário não encontrado');
    return data as AppUser;
  }

  async setOnline(id: string, isOnline: boolean): Promise<void> {
    await this.supabase
      .from('users')
      .update({ is_online: isOnline })
      .eq('id', id);
  }
}
```

- [ ] **Step 6.5: Criar UsersController**

```typescript
// apps/api/src/modules/users/users.controller.ts
import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import type { User } from '@supabase/supabase-js';

@Controller('users')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getMe(@CurrentUser() authUser: User) {
    return this.usersService.findById(authUser.id);
  }

  @Patch('me')
  async updateMe(
    @CurrentUser() authUser: User,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(authUser.id, dto);
  }
}
```

- [ ] **Step 6.6: Criar UsersModule**

```typescript
// apps/api/src/modules/users/users.module.ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { AuthModule } from '../auth/auth.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [AuthModule],
  providers: [
    {
      provide: 'SUPABASE_CLIENT',
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createClient(
          config.get<string>('supabase.url') ?? '',
          config.get<string>('supabase.serviceRoleKey') ?? '',
        ),
    },
    {
      provide: UsersService,
      inject: ['SUPABASE_CLIENT'],
      useFactory: (supabase: ReturnType<typeof createClient>) =>
        new UsersService(supabase),
    },
  ],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 6.7: Registrar UsersModule no AppModule**

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import configuration from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    AuthModule,
    UsersModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
```

- [ ] **Step 6.8: Rodar todos os testes**

```bash
pnpm --filter @crmwhats/api test
```

Expected: `Tests: 6 passed` (3 auth + 3 users)

- [ ] **Step 6.9: Commit**

```bash
git add apps/api/src/modules/users/
git add apps/api/src/app.module.ts
git commit -m "feat(api): UsersModule with GET/PATCH /api/users/me"
```

---

## Task 7: Next.js Web — Setup e Design System AMMOC

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/src/styles/ammoc.css`
- Create: `apps/web/src/styles/globals.css`
- Create: `apps/web/src/lib/supabase/client.ts`
- Create: `apps/web/src/lib/supabase/server.ts`
- Create: `apps/web/middleware.ts`

- [ ] **Step 7.1: Criar package.json do web**

```json
{
  "name": "@crmwhats/web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "@crmwhats/types": "workspace:*",
    "@supabase/ssr": "^0.5.0",
    "@supabase/supabase-js": "^2.49.0",
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 7.2: Criar tsconfig.json do web**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "preserve",
    "incremental": true,
    "noEmit": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"],
      "@crmwhats/types": ["../../packages/types/src/index.ts"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 7.3: Criar next.config.ts**

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@crmwhats/types'],
};

export default nextConfig;
```

- [ ] **Step 7.4: Criar tokens AMMOC CSS**

Criar `apps/web/src/styles/ammoc.css`:

```css
/* AMMOC Design System — tokens extraídos de system.css */
@import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700;800;900&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

:root {
  /* Brand greens */
  --ammoc-green-900: #0F4B22;
  --ammoc-green-800: #166331;
  --ammoc-green-700: #1F7A3D;
  --ammoc-green:     #2A8A3A;
  --ammoc-green-500: #3FA34F;
  --ammoc-green-100: #E6F0E5;
  --ammoc-green-50:  #F2F7EF;

  /* Brand reds */
  --ammoc-red-900:  #872A23;
  --ammoc-red-700:  #C2342B;
  --ammoc-red:      #E94434;
  --ammoc-red-100:  #FCEBE8;

  /* Neutrals */
  --ammoc-ink-900: #1F1F1F;
  --ammoc-ink:     #2F2F2F;
  --ammoc-ink-600: #555555;
  --ammoc-ink-400: #8A8A8A;
  --ammoc-line:    #D8D4CC;
  --ammoc-line-2:  #ECEAE3;
  --ammoc-paper:   #FFFFFF;
  --ammoc-paper-2: #FAF7F1;
  --ammoc-paper-3: #F2EFE7;

  /* Status */
  --status-online:  #4ade80;
  --status-offline: var(--ammoc-line);
  --color-yellow:   #D97706;
  --color-yellow-bg:#FEF3C7;
  --color-blue:     #1D4ED8;
  --color-blue-bg:  #EFF6FF;

  /* Typography */
  --font-display: "Barlow", "Inter", system-ui, sans-serif;
  --font-body:    "Inter", system-ui, sans-serif;
  --font-mono:    "JetBrains Mono", ui-monospace, monospace;

  /* Spacing (base 4px) */
  --s-1: 4px;  --s-2: 8px;   --s-3: 12px; --s-4: 16px;
  --s-5: 20px; --s-6: 24px;  --s-8: 32px; --s-10: 40px;

  /* Radius */
  --radius-sm: 6px;
  --radius:    10px;
  --radius-lg: 14px;

  /* Shadows */
  --shadow-card: 0 1px 3px rgba(0,0,0,.04), 0 4px 12px rgba(0,0,0,.06);
  --shadow-lg:   0 4px 6px rgba(0,0,0,.04), 0 12px 40px rgba(0,0,0,.07);
}
```

- [ ] **Step 7.5: Criar globals.css**

Criar `apps/web/src/styles/globals.css`:

```css
@import './ammoc.css';

*, *::before, *::after { box-sizing: border-box; }

html, body {
  margin: 0; padding: 0;
  height: 100%;
  font-family: var(--font-body);
  font-size: 14px;
  color: var(--ammoc-ink);
  background: var(--ammoc-paper-3);
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--font-display);
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--ammoc-ink-900);
}

a { color: var(--ammoc-green); text-decoration: none; }
a:hover { text-decoration: underline; }

button { cursor: pointer; font-family: var(--font-body); }

::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--ammoc-line); border-radius: 99px; }
```

- [ ] **Step 7.6: Criar supabase client (browser)**

Criar `apps/web/src/lib/supabase/client.ts`:

```typescript
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

- [ ] **Step 7.7: Criar supabase client (server)**

Criar `apps/web/src/lib/supabase/server.ts`:

```typescript
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component — cookies só podem ser modificados em Server Actions/Route Handlers
          }
        },
      },
    },
  );
}
```

- [ ] **Step 7.8: Criar middleware de proteção de rotas**

Criar `apps/web/middleware.ts`:

```typescript
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname.startsWith('/login');
  const isPublicRoute = pathname === '/' || isAuthRoute;

  if (!user && !isPublicRoute) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (user && isAuthRoute) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
```

- [ ] **Step 7.9: Criar .env.local**

Criar `apps/web/.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xfqphbdurynuwvrnxpvj.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
NEXT_PUBLIC_API_URL=http://localhost:3001
```

**Preencher `NEXT_PUBLIC_SUPABASE_ANON_KEY`:** buscar em https://supabase.com/dashboard/project/xfqphbdurynuwvrnxpvj/settings/api → "anon public" key.

- [ ] **Step 7.10: Instalar dependências do web**

```bash
cd "C:\Users\max_m\OneDrive\Área de Trabalho\GERENCIAMENTO WHATSAPP"
pnpm install
```

- [ ] **Step 7.11: Commit**

```bash
git add apps/web/
git commit -m "feat(web): Next.js setup with AMMOC design system and Supabase auth"
```

---

## Task 8: Páginas de Auth — Login

**Files:**
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/app/(auth)/layout.tsx`
- Create: `apps/web/src/app/(auth)/login/page.tsx`
- Create: `apps/web/src/app/(auth)/login/login.module.css`

- [ ] **Step 8.1: Criar root layout**

```tsx
// apps/web/src/app/layout.tsx
import type { Metadata } from 'next';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'AMMOC CRMWhats',
  description: 'Sistema de gestão de WhatsApp da AMMOC',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 8.2: Criar root page (redirect)**

```tsx
// apps/web/src/app/page.tsx
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function RootPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  redirect(user ? '/dashboard' : '/login');
}
```

- [ ] **Step 8.3: Criar layout de auth (sem sidebar)**

```tsx
// apps/web/src/app/(auth)/layout.tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--ammoc-paper-3)',
    }}>
      {children}
    </main>
  );
}
```

- [ ] **Step 8.4: Criar CSS da página de login**

Criar `apps/web/src/app/(auth)/login/login.module.css`:

```css
.card {
  background: var(--ammoc-paper);
  border: 1px solid var(--ammoc-line-2);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: 40px 36px;
  width: 100%;
  max-width: 400px;
}

.logo {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 28px;
}

.logoMark {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--ammoc-green-800);
  display: flex;
  align-items: center;
  justify-content: center;
}

.logoText h1 {
  font-size: 18px;
  font-weight: 900;
  color: var(--ammoc-ink-900);
  margin: 0;
  letter-spacing: -0.02em;
}

.logoText p {
  font-size: 11px;
  color: var(--ammoc-ink-400);
  margin: 1px 0 0;
  font-family: var(--font-mono);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.title {
  font-size: 20px;
  font-weight: 800;
  color: var(--ammoc-ink-900);
  margin-bottom: 4px;
  letter-spacing: -0.02em;
}

.subtitle {
  font-size: 13px;
  color: var(--ammoc-ink-600);
  margin-bottom: 24px;
}

.field {
  margin-bottom: 14px;
}

.label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--ammoc-ink);
  margin-bottom: 5px;
}

.input {
  width: 100%;
  border: 1.5px solid var(--ammoc-line);
  border-radius: var(--radius-sm);
  padding: 9px 12px;
  font-size: 14px;
  font-family: var(--font-body);
  background: var(--ammoc-paper);
  color: var(--ammoc-ink);
  outline: none;
  transition: border-color 0.15s;
}

.input:focus {
  border-color: var(--ammoc-green-500);
}

.submit {
  width: 100%;
  background: var(--ammoc-green);
  color: white;
  border: none;
  border-radius: var(--radius-sm);
  padding: 10px;
  font-size: 14px;
  font-weight: 700;
  font-family: var(--font-body);
  cursor: pointer;
  margin-top: 8px;
  transition: background 0.15s;
}

.submit:hover { background: var(--ammoc-green-700); }
.submit:disabled { opacity: 0.6; cursor: not-allowed; }

.error {
  background: var(--ammoc-red-100);
  border: 1px solid #fca5a5;
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  font-size: 12.5px;
  color: var(--ammoc-red-700);
  margin-top: 12px;
}
```

- [ ] **Step 8.5: Criar página de login**

```tsx
// apps/web/src/app/(auth)/login/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import styles from './login.module.css';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError('Email ou senha incorretos. Tente novamente.');
      setLoading(false);
      return;
    }

    router.push('/dashboard');
    router.refresh();
  }

  return (
    <div className={styles.card}>
      <div className={styles.logo}>
        <div className={styles.logoMark}>
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <circle cx="11" cy="11" r="9" stroke="white" strokeWidth="2"/>
            <path d="M11 6v5l3 3" stroke="white" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </div>
        <div className={styles.logoText}>
          <h1>AMMOC</h1>
          <p>CRMWhats</p>
        </div>
      </div>

      <div className={styles.title}>Entrar</div>
      <div className={styles.subtitle}>Acesse o sistema de gestão WhatsApp da AMMOC</div>

      <form onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="email">Email</label>
          <input
            id="email"
            className={styles.input}
            type="email"
            placeholder="seu@ammoc.org.br"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="password">Senha</label>
          <input
            id="password"
            className={styles.input}
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <button
          className={styles.submit}
          type="submit"
          disabled={loading}
        >
          {loading ? 'Entrando...' : 'Entrar →'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 8.6: Testar o login**

```bash
pnpm --filter @crmwhats/web dev
```

Abrir http://localhost:3000 — deve redirecionar para `/login`.

Para criar o primeiro usuário Admin no Supabase:
1. Acessar https://supabase.com/dashboard/project/xfqphbdurynuwvrnxpvj/auth/users
2. Clicar "Add user" → "Create new user"
3. Criar `admin@ammoc.org.br` com senha forte
4. No SQL Editor, atualizar o role: `UPDATE public.users SET role = 'admin' WHERE email = 'admin@ammoc.org.br';`

Testar login com esse usuário — deve redirecionar para `/dashboard` (404 por ora).

- [ ] **Step 8.7: Commit**

```bash
git add apps/web/src/app/
git commit -m "feat(web): login page with Supabase auth"
```

---

## Task 9: App Shell — Layout com Sidebar AMMOC

**Files:**
- Create: `apps/web/src/app/(app)/layout.tsx`
- Create: `apps/web/src/app/(app)/dashboard/page.tsx`
- Create: `apps/web/src/components/layout/AppShell.tsx`
- Create: `apps/web/src/components/layout/AppShell.module.css`
- Create: `apps/web/src/components/layout/Sidebar.tsx`
- Create: `apps/web/src/components/layout/Sidebar.module.css`

- [ ] **Step 9.1: Criar CSS do AppShell**

Criar `apps/web/src/components/layout/AppShell.module.css`:

```css
.shell {
  display: grid;
  grid-template-columns: 216px 1fr;
  min-height: 100vh;
  background: var(--ammoc-paper-2);
}

.main {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}
```

- [ ] **Step 9.2: Criar CSS do Sidebar**

Criar `apps/web/src/components/layout/Sidebar.module.css`:

```css
.sidebar {
  background: var(--ammoc-green-800);
  border-right: 1px solid var(--ammoc-green-900);
  display: flex;
  flex-direction: column;
  height: 100vh;
  position: sticky;
  top: 0;
  overflow-y: auto;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 16px 16px;
  border-bottom: 1px solid rgba(255,255,255,.09);
  flex-shrink: 0;
}

.logoMark {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: white;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.brandName {
  font-family: var(--font-display);
  font-weight: 900;
  font-size: 15px;
  color: white;
  letter-spacing: -0.01em;
  line-height: 1;
}

.brandSub {
  font-size: 9px;
  color: rgba(255,255,255,.4);
  font-family: var(--font-mono);
  text-transform: uppercase;
  letter-spacing: .1em;
  margin-top: 2px;
}

.body {
  padding: 12px 10px;
  flex: 1;
  overflow-y: auto;
}

.navSection {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: rgba(255,255,255,.3);
  padding: 12px 8px 5px;
  font-family: var(--font-mono);
}

.navItem {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  border-radius: 7px;
  font-size: 12.5px;
  font-weight: 500;
  color: rgba(255,255,255,.5);
  cursor: pointer;
  text-decoration: none;
  transition: all 0.12s;
}

.navItem:hover {
  background: rgba(255,255,255,.06);
  color: rgba(255,255,255,.75);
  text-decoration: none;
}

.navItem.active {
  background: rgba(255,255,255,.12);
  color: white;
}

.navIcon {
  font-size: 14px;
  width: 18px;
  text-align: center;
  flex-shrink: 0;
}

.navBadge {
  margin-left: auto;
  background: var(--ammoc-red);
  color: white;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 99px;
}

.navDot {
  margin-left: auto;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--status-online);
}

.footer {
  border-top: 1px solid rgba(255,255,255,.09);
  padding: 12px 10px;
  flex-shrink: 0;
}

.userRow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 7px;
}

.avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--ammoc-green-500), var(--ammoc-green-700));
  border: 1.5px solid rgba(255,255,255,.25);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: 700;
  font-size: 12px;
  flex-shrink: 0;
}

.userName {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255,255,255,.85);
}

.userRole {
  font-size: 10px;
  color: rgba(255,255,255,.35);
  font-family: var(--font-mono);
  text-transform: uppercase;
  letter-spacing: .06em;
}

.statusDot {
  margin-left: auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--status-online);
  border: 1.5px solid var(--ammoc-green-800);
}

.logoutBtn {
  background: none;
  border: none;
  color: rgba(255,255,255,.35);
  font-size: 11px;
  padding: 4px 10px;
  cursor: pointer;
  width: 100%;
  text-align: left;
  border-radius: 5px;
  margin-top: 4px;
  transition: color 0.12s;
}

.logoutBtn:hover {
  color: rgba(255,255,255,.65);
  background: rgba(255,255,255,.05);
}
```

- [ ] **Step 9.3: Criar componente Sidebar**

```tsx
// apps/web/src/components/layout/Sidebar.tsx
'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { AppUser } from '@crmwhats/types';
import styles from './Sidebar.module.css';

interface NavItem {
  icon: string;
  label: string;
  href: string;
  badge?: number;
  dot?: boolean;
}

const FUNCIONARIO_NAV: NavItem[] = [
  { icon: '💬', label: 'Conversas', href: '/dashboard' },
  { icon: '📋', label: 'Atendimentos', href: '/atendimentos' },
  { icon: '📥', label: 'Recebidos', href: '/recebidos' },
];

const WHATSAPP_NAV: NavItem[] = [
  { icon: '📱', label: 'Meu número', href: '/meu-numero', dot: true },
  { icon: '🔔', label: 'Notificações', href: '/notificacoes' },
];

const ORG_NAV: NavItem[] = [
  { icon: '🏛️', label: 'Base AMMOC', href: '/base' },
  { icon: '👥', label: 'Equipe', href: '/equipe' },
];

const ADMIN_NAV: NavItem[] = [
  { icon: '📊', label: 'Painel Admin', href: '/admin' },
  { icon: '⚙️', label: 'Configurações', href: '/configuracoes' },
];

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

interface SidebarProps {
  user: AppUser;
}

export default function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  function NavLink({ item }: { item: NavItem }) {
    const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
    return (
      <Link href={item.href} className={`${styles.navItem} ${isActive ? styles.active : ''}`}>
        <span className={styles.navIcon}>{item.icon}</span>
        {item.label}
        {item.badge != null && <span className={styles.navBadge}>{item.badge}</span>}
        {item.dot && <span className={styles.navDot} />}
      </Link>
    );
  }

  return (
    <nav className={styles.sidebar}>
      <div className={styles.brand}>
        <div className={styles.logoMark}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <rect x="2" y="2" width="16" height="16" rx="4" fill="var(--ammoc-green-800)"/>
            <path d="M6 10h8M10 6v8" stroke="white" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </div>
        <div>
          <div className={styles.brandName}>AMMOC</div>
          <div className={styles.brandSub}>CRMWhats</div>
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.navSection}>Meu painel</div>
        {FUNCIONARIO_NAV.map(item => <NavLink key={item.href} item={item} />)}

        <div className={styles.navSection}>WhatsApp</div>
        {WHATSAPP_NAV.map(item => <NavLink key={item.href} item={item} />)}

        <div className={styles.navSection}>Organização</div>
        {ORG_NAV.map(item => <NavLink key={item.href} item={item} />)}

        {(user.role === 'supervisor' || user.role === 'admin') && (
          <>
            <div className={styles.navSection}>Admin</div>
            {ADMIN_NAV.map(item => <NavLink key={item.href} item={item} />)}
          </>
        )}
      </div>

      <div className={styles.footer}>
        <div className={styles.userRow}>
          <div className={styles.avatar}>{initials(user.name)}</div>
          <div>
            <div className={styles.userName}>{user.name}</div>
            <div className={styles.userRole}>{user.role}</div>
          </div>
          <div className={styles.statusDot} />
        </div>
        <button className={styles.logoutBtn} onClick={handleLogout}>
          Sair da conta
        </button>
      </div>
    </nav>
  );
}
```

- [ ] **Step 9.4: Criar componente AppShell**

```tsx
// apps/web/src/components/layout/AppShell.tsx
import Sidebar from './Sidebar';
import type { AppUser } from '@crmwhats/types';
import styles from './AppShell.module.css';

interface AppShellProps {
  user: AppUser;
  children: React.ReactNode;
}

export default function AppShell({ user, children }: AppShellProps) {
  return (
    <div className={styles.shell}>
      <Sidebar user={user} />
      <div className={styles.main}>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 9.5: Criar layout do app (rota protegida)**

```tsx
// apps/web/src/app/(app)/layout.tsx
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import AppShell from '@/components/layout/AppShell';
import type { AppUser } from '@crmwhats/types';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();

  if (!authUser) redirect('/login');

  const { data: appUser } = await supabase
    .from('users')
    .select('*')
    .eq('id', authUser.id)
    .single();

  if (!appUser) redirect('/login');

  return <AppShell user={appUser as AppUser}>{children}</AppShell>;
}
```

- [ ] **Step 9.6: Criar página de dashboard (placeholder)**

```tsx
// apps/web/src/app/(app)/dashboard/page.tsx
export default function DashboardPage() {
  return (
    <div style={{ padding: '24px', flex: 1 }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '22px', marginBottom: '8px' }}>
        Minhas Conversas
      </h1>
      <p style={{ color: 'var(--ammoc-ink-400)', fontSize: '13px' }}>
        Fase 1 concluída ✓ — funcionalidades de WhatsApp chegam na Fase 2.
      </p>
    </div>
  );
}
```

- [ ] **Step 9.7: Testar o fluxo completo**

```bash
pnpm --filter @crmwhats/web dev
```

1. Abrir http://localhost:3000 → redireciona para `/login`
2. Fazer login com `admin@ammoc.org.br`
3. Deve redirecionar para `/dashboard` com sidebar verde AMMOC e nome do usuário no rodapé
4. Clicar "Sair da conta" → redireciona para `/login`

- [ ] **Step 9.8: Commit final da Fase 1**

```bash
git add apps/web/src/
git commit -m "feat(web): AppShell with AMMOC sidebar and protected routes"
```

---

## Resultado da Fase 1

Ao final desta fase o sistema tem:

- ✅ Monorepo pnpm com `@crmwhats/api`, `@crmwhats/web`, `@crmwhats/types`
- ✅ Schema Supabase completo (11 tabelas + RLS + trigger de criação de usuário)
- ✅ NestJS API rodando em `:3001` com health check + auth guard + `GET /api/users/me`
- ✅ Next.js web em `:3000` com login funcional, middleware de proteção, sidebar AMMOC
- ✅ 6 testes passando (auth guard + users service)
- ✅ Design system AMMOC aplicado (verde `#166331`, Barlow + Inter, tokens CSS)

**Próximo plano:** `2026-05-28-fase2-whatsapp-core.md` — WhatsApp instances, webhooks, lista de conversas.
