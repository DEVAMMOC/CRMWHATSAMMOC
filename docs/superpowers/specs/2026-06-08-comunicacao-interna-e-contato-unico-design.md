# Design — Comunicação Interna + Contato Único (2026-06-08)

Dois recursos independentes do CRMWhats AMMOC, entregues em branches separadas.

---

## Feature 1 — Comunicação Interna (chat 1:1 entre usuários)

### Objetivo
Permitir que usuários do sistema conversem entre si (comunicação interna), com
histórico persistido. Item próprio **"Comunicação Interna"** na sidebar, com
badge de não-lidas.

### Escopo (YAGNI)
- Apenas **texto** e apenas **1:1** (sem grupos, sem mídia, sem notas-no-atendimento).
- Estende-se depois se necessário.

### Dados
Tabela `internal_messages`:
- `id uuid pk default gen_random_uuid()`
- `sender_id uuid` → `users(id) on delete set null`
- `recipient_id uuid` → `users(id) on delete set null`
- `body text not null`
- `read_at timestamptz null`
- `created_at timestamptz default now()`
- Índices: `(recipient_id, read_at)`, `(sender_id, recipient_id, created_at)`.

**RLS** (acesso direto via client supabase com JWT, padrão `/contatos`/`/dashboard`):
- SELECT: `sender_id = auth.uid() OR recipient_id = auth.uid()`
- INSERT: `with check (sender_id = auth.uid())`
- UPDATE (marcar lido): `using (recipient_id = auth.uid())`

### Fluxo / Componentes
- Página `/comunicacao-interna` (split): lista de usuários à esquerda (de
  `GET /api/users`, já existente — id+name), conversa à direita. Poll 5s.
- Enviar: `insert` direto em `internal_messages` (RLS garante `sender_id`).
- Histórico com X: `select` onde (`sender_id=me AND recipient_id=X`) OR (inverso),
  ordenado por `created_at`.
- Marcar lido: ao abrir a conversa com X, `update read_at=now()` nas mensagens
  recebidas de X ainda não lidas.
- **Badge sidebar:** count de `recipient_id=me AND read_at IS NULL` (poll).
- Sem novo módulo NestJS — tudo via client supabase RLS-scoped.

### Erros
- Falha de envio: mantém o texto no campo e mostra erro inline (padrão dos painéis).
- Lista de usuários vazia / 401: dropdown vazio, sem quebrar.

---

## Feature 2 — Contato Único (entidade canônica por número normalizado)

### Problema (causa raiz)
A mesma pessoa vira 2 registros: `conversations` (pessoal, coluna
`contact_number`) e `canal_conversations` (Canal, coluna `wa_contact_number`).
A mesclagem atual em `/contatos` é só de view e quebra quando o número está em
formatos diferentes: com/sem `55` (código país), 9º dígito, ou JID `@lid`.

### Solução
Entidade canônica `contacts`, chaveada por número normalizado; os dois canais
apontam para o mesmo contato via `contact_id`. Nome/foto/categorias/contagem
passam a ser do **contato**, não do canal.

### Normalização (chave canônica)
Função SQL `normalize_phone(raw text) -> text` (immutable):
1. Remove tudo que não é dígito.
2. Se começa com `55` e o total tem ≥ 12 dígitos, remove o `55` inicial
   (deixa DDD+número nacional).
3. Resultado vazio → contato não é criado (`contact_id` fica null).

Helper espelhado no front `apps/web/src/lib/phone.ts` (`phoneKey(raw)`) com a
mesma regra, para agrupamentos client-side coincidirem com o banco.

**Limitação conhecida:** números só-`@lid` sem dígitos reais resolvíveis podem
não mesclar (ficam com a própria chave). Hoje o webhook resolve JID→número real
(RecipientAlt/SenderAlt), então o caso é raro; documentado.

### Dados
Tabela `contacts`:
- `id uuid pk default gen_random_uuid()`
- `phone_key text unique not null`
- `display_name text null`
- `photo_url text null`
- `municipality text null`
- `created_at`, `updated_at timestamptz default now()`

Alterações:
- `conversations` += `contact_id uuid references contacts(id) on delete set null`
- `canal_conversations` += `contact_id uuid references contacts(id) on delete set null`
- `contact_category_assignments` += `contact_id` (mantém `contact_number` por ora);
  reads/writes passam a usar `contact_id`.
- `contact_photos` += `contact_id`; idem.

### Sincronização (sem código de app)
Triggers `BEFORE INSERT/UPDATE OF <num>` em `conversations` e `canal_conversations`:
- Função resolve `phone_key = normalize_phone(<coluna do número>)`.
- Se key ≠ '': `upsert` em `contacts` (insere se novo, pega id) e seta `NEW.contact_id`.
- Centraliza a lógica: webhook/ingest não precisam mudar.

### Backfill (na migração)
1. `insert into contacts (phone_key, display_name, municipality)` a partir do
   `union all` dos números dos dois canais, agrupado por `normalize_phone`,
   pegando um nome/município representativo. `on conflict (phone_key) do nothing`.
2. `update conversations/canal_conversations set contact_id` via join por
   `phone_key`.
3. `update contact_category_assignments/contact_photos set contact_id` via join
   por `normalize_phone(contact_number)`.

### UI
- `/contatos`: agrupar por `contact_id` (fallback `phone_key`); nome/foto/
  categorias do contato. Número X via Canal **e** compartilhado = **1 card**.
- Gestão de categorias/fotos (admin/supervisor) passa a referenciar `contact_id`.

### Erros / segurança
- `normalize_phone` nunca lança (regex sobre string vazia → '').
- `contacts` legível por todos autenticados (RLS select true) — é dado de contato
  já exposto no /contatos; sem segredos. Escrita só via trigger (service-role) /
  gestão admin.

---

## Entrega
- Branch `feat/comunicacao-interna` e branch `feat/contato-unico` (separadas).
- TDD onde fizer sentido (normalize_phone, helpers); testes de serviço/spec.
- Build API+types+web; deploy Coolify `force=true` (evita o gotcha do incremental).
- Verificação ao vivo + atualização do handoff.
