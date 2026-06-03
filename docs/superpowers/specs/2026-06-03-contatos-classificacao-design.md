# Contatos — Base unificada, foto e classificação (Fase A) — Design Spec

**Data:** 2026-06-03
**Status:** Aprovado

## Objetivo
Evoluir a "Base AMMOC" (`/base`) para uma **base de Contatos** única: renomear para **Contatos**, **unir** os contatos das conversas pessoais (`conversations`) com os cidadãos do Canal oficial (`canal_conversations`), exibir **nome e foto**, e permitir **classificar** contatos por **categorias livres** (cidade, associação, fornecedor, ou o que o usuário definir), com múltiplas categorias por contato e filtro.

> **Fase B (depois, fora daqui):** recepção de mídia recebida (baixar/guardar/exibir imagem/áudio/documento nas conversas).

## Decisões (brainstorming)
- Contatos primeiro; mídia depois.
- Classificação = **categorias criadas pelo usuário** (nome + cor), **múltiplas por contato**, com filtro.
- Foto: a API oficial da Meta **não expõe foto dos cidadãos** (confirmado: `/{wa_id}?fields=picture` → erro). Logo: **foto manual por contato** (cobre todos) + **avatar automático** onde houver (Evolution) + **iniciais** como fallback.

## Modelo de dados (Supabase, via MCP)
```sql
CREATE TABLE contact_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  color      text NOT NULL DEFAULT '#128C7E',
  created_at timestamptz DEFAULT now()
);
CREATE TABLE contact_category_assignments (
  contact_number text NOT NULL,
  category_id     uuid NOT NULL REFERENCES contact_categories(id) ON DELETE CASCADE,
  created_at      timestamptz DEFAULT now(),
  PRIMARY KEY (contact_number, category_id)
);
CREATE TABLE contact_photos (
  contact_number text PRIMARY KEY,
  photo_url      text NOT NULL,
  updated_at     timestamptz DEFAULT now()
);
CREATE INDEX idx_cca_category ON contact_category_assignments(category_id);
```
**RLS:** leitura para qualquer autenticado (todos veem categorias/atribuições/fotos); **escrita** (insert/update/delete) só **admin/supervisor** via `current_user_role() = ANY(ARRAY['admin','supervisor']::user_role[])`. Inserts/updates feitos pelo **Supabase client** (não pelo service-role), então a RLS de escrita realmente protege.

**Storage:** bucket existente `wa-media` (ou subpasta `contacts/`) para as fotos enviadas; URL pública salva em `contact_photos.photo_url`.

## Frontend
**Rota:** renomear o diretório `apps/web/src/app/(app)/base` → `apps/web/src/app/(app)/contatos`. Atualizar o link no `Sidebar.tsx` (`ORG_NAV`): label **Contatos**, href `/contatos`, ícone 📇 (ou manter 🏛️). Título da página → "Contatos".

**Carregamento (via Supabase client — RLS-scoped):**
- Contatos pessoais: `conversations` (exceto `nao_salva`) — campos atuais.
- Cidadãos do canal: `canal_conversations` — `wa_contact_number`, `wa_contact_name`, `status`, `last_message_at` (sem município). Marcar origem `canal`.
- **Dedupe por `contact_number`** (normalizar só dígitos), mantendo a entrada mais recente; mesclar origem (um contato pode ser dos dois).
- Carregar `contact_categories`, `contact_category_assignments` (mapa número→categorias) e `contact_photos` (mapa número→url).
- Avatares automáticos (Evolution): reutilizar `GET /api/whatsapp/avatar?number=` (como em meu-numero), só para os que não têm foto manual — lazy, primeiros N visíveis.

**UI:**
- Busca (nome/número/município) + **chips de filtro por categoria** (Todas + uma por categoria, com cor) + filtro por origem opcional.
- Card do contato: **foto** (manual > avatar Evolution > iniciais), nome, número formatado, município (se houver), badge de origem (pessoal/canal), **chips das categorias** com ✕ para remover + botão "＋ categoria" (menu das categorias existentes para atribuir), e botão **📷 foto** (upload → Storage → `contact_photos`).
- **Gerenciar categorias** (admin/supervisor): seção/modal para criar (nome + cor) e excluir categorias.
- Estilo com `--ammoc-*`, responsivo (`useIsMobile`), consistente com a página atual.

## Componentes / responsabilidades
- Página `contatos/page.tsx`: carregamento unificado + dedupe + render + filtros.
- A lógica de foto (manual/avatar/iniciais) e os chips de categoria podem virar pequenos componentes internos se o arquivo crescer muito.
- Sem novo módulo de API — tudo via Supabase client + RLS + Storage.

## Tratamento de erros
- Falha ao carregar uma fonte → mostra a outra + aviso discreto.
- Upload de foto falho → erro no card, sem travar.
- Escrita sem permissão (não admin/supervisor) → RLS bloqueia; UI esconde os controles de gestão para não-admins.

## Verificação
- Migrations aplicadas (tabelas + RLS) e conferidas via MCP.
- `tsc --noEmit` limpo; rota `/contatos` no ar, `/base` removida (ou redireciona).
- Logado: criar categoria, atribuir a um contato, filtrar por ela, subir uma foto e vê-la; conferir que um não-admin não vê os controles de gestão; contatos do canal aparecem junto com os pessoais.

## Fora de escopo
- Recepção/exibição de mídia recebida (Fase B).
- Foto automática de cidadãos do Canal (impossível pela API Meta — usa manual/iniciais).
- Importação/edição em massa, exportar CSV (possível melhoria futura).
