# Minhas Conversas — Chat Panel + Envio (texto e mídia) + Fotos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar a aba "Minhas Conversas" num split de 2 colunas (lista + painel de conversa) que mostra histórico e envia texto e mídia (imagem/vídeo/áudio/documento) via Supabase Storage, e corrigir as fotos de perfil dos contatos.

**Architecture:** Frontend Next.js (client component) com painel de conversa novo lendo `messages` do Supabase e enviando via API NestJS. Mídia sobe pro Supabase Storage (bucket `wa-media`) e a URL pública é enviada ao Evolution Go (`POST /send/media`). Fotos corrigidas formatando o JID (`<número>@s.whatsapp.net`).

**Tech Stack:** NestJS + Supabase (Postgres + Storage) + Evolution Go + Next.js 15 + TypeScript.

**Fatos confirmados ao vivo (Evolution Go em http://2.25.139.166:8085):**
- Avatar: `POST /user/avatar` com `{ number: "<digits>@s.whatsapp.net" }` → `{ data: { url } }`. Com número puro dá timeout.
- Mídia: `POST /send/media` com `{ number, mediatype: 'image'|'video'|'audio'|'document', media: <URL pública>, fileName?, caption?, formatJid: true }`. Autentica com header `apikey: <instanceToken>`.
- Texto (já existe): `POST /send/text` `{ number, text, formatJid: true }`.

---

## File Structure

**Modificados:**
- `apps/api/src/modules/whatsapp/evolution.service.ts` — corrigir `getContactAvatar` (JID) + novo `sendMedia`.
- `apps/api/src/modules/whatsapp/whatsapp.service.ts` — novo `sendMediaMessage`.
- `apps/api/src/modules/whatsapp/whatsapp.controller.ts` — novo `POST /send-media`.
- `apps/web/src/app/(app)/meu-numero/page.tsx` — layout split + estado de seleção.

**Novos:**
- `apps/api/src/modules/whatsapp/dto/send-media.dto.ts`
- `apps/web/src/app/(app)/meu-numero/ConversationPanel.tsx`

**DB/Storage (via Supabase MCP):**
- `messages.media_url text` (migration)
- Bucket `wa-media` + policies

---

### Task 1: Corrigir fotos de contato (avatar JID)

**Files:**
- Modify: `apps/api/src/modules/whatsapp/evolution.service.ts` (método `getContactAvatar`, ~linha 168-181)

- [ ] **Step 1: Ajustar `getContactAvatar` para enviar o JID completo**

Substituir o corpo do método `getContactAvatar` por:
```typescript
  async getContactAvatar(token: string, number: string): Promise<string | null> {
    try {
      // Evolution Go exige o JID completo; com número puro a query de perfil dá timeout.
      const digits = number.replace(/\D/g, '');
      const jid = `${digits}@s.whatsapp.net`;
      const res = await fetch(`${this.baseUrl}/user/avatar`, {
        method: 'POST',
        headers: this.instanceHeaders(token),
        body: JSON.stringify({ number: jid }),
      });
      if (!res.ok) return null;
      const result = await res.json() as { data?: { profilePicUrl?: string; url?: string } };
      return result.data?.profilePicUrl ?? result.data?.url ?? null;
    } catch {
      return null;
    }
  }
```

- [ ] **Step 2: Build da API**

Run: `pnpm --filter @crmwhats/api build`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/whatsapp/evolution.service.ts
git commit -m "fix(whatsapp): use full JID for contact avatar lookup (fixes missing photos)"
```

---

### Task 2: Migration — coluna media_url em messages

**Files:**
- Migration via Supabase MCP (project ref `xfqphbdurynuwvrnxpvj`)

- [ ] **Step 1: Aplicar migration**

Usar `mcp__supabase__apply_migration` (name: `add_media_url_to_messages`) com:
```sql
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url text;
```

- [ ] **Step 2: Verificar coluna**

Usar `mcp__supabase__execute_sql`:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'messages' AND column_name = 'media_url';
```
Expected: 1 linha.

- [ ] **Step 3: Verificar constraint de message_type**

Usar `mcp__supabase__execute_sql` para checar se há CHECK em `message_type`:
```sql
SELECT con.conname, pg_get_constraintdef(con.oid)
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
WHERE rel.relname = 'messages' AND con.contype = 'c';
```
Se existir um CHECK restringindo `message_type` a valores que não incluem `image,video,audio,document`, aplicar migration ajustando-o para aceitar `('text','image','video','audio','document')`. Se não houver CHECK (coluna text livre), nenhuma ação.

- [ ] **Step 4: Commit nota**

```bash
git commit --allow-empty -m "feat: add media_url column to messages via Supabase MCP"
```

---

### Task 3: Supabase Storage — bucket wa-media

**Files:**
- Via Supabase MCP `execute_sql` (storage schema)

- [ ] **Step 1: Criar bucket público `wa-media`**

Usar `mcp__supabase__execute_sql`:
```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('wa-media', 'wa-media', true, 26214400, NULL)
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 26214400;
```
(26214400 = 25 MB; leitura pública para o Evolution Go baixar a URL.)

- [ ] **Step 2: Policy de upload (apenas autenticados, no próprio prefixo do usuário)**

Usar `mcp__supabase__execute_sql`:
```sql
DROP POLICY IF EXISTS "wa_media_insert_own" ON storage.objects;
CREATE POLICY "wa_media_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'wa-media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "wa_media_read_public" ON storage.objects;
CREATE POLICY "wa_media_read_public" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'wa-media');
```

- [ ] **Step 3: Verificar bucket**

```sql
SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'wa-media';
```
Expected: 1 linha, public = true.

- [ ] **Step 4: Commit nota**

```bash
git commit --allow-empty -m "feat: create wa-media Supabase Storage bucket + policies"
```

---

### Task 4: Backend — envio de mídia

**Files:**
- Create: `apps/api/src/modules/whatsapp/dto/send-media.dto.ts`
- Modify: `apps/api/src/modules/whatsapp/evolution.service.ts` (novo `sendMedia`)
- Modify: `apps/api/src/modules/whatsapp/whatsapp.service.ts` (novo `sendMediaMessage`)
- Modify: `apps/api/src/modules/whatsapp/whatsapp.controller.ts` (novo endpoint)

- [ ] **Step 1: Criar `SendMediaDto`**

`apps/api/src/modules/whatsapp/dto/send-media.dto.ts`:
```typescript
import { IsString, IsNotEmpty, IsIn, IsOptional, IsUrl } from 'class-validator';

export class SendMediaDto {
  @IsString() @IsNotEmpty()
  conversationId!: string;

  @IsUrl()
  mediaUrl!: string;

  @IsIn(['image', 'video', 'audio', 'document'])
  mediaType!: 'image' | 'video' | 'audio' | 'document';

  @IsString() @IsNotEmpty()
  fileName!: string;

  @IsString() @IsOptional()
  caption?: string;
}
```

- [ ] **Step 2: Adicionar `sendMedia` ao EvolutionService**

Em `apps/api/src/modules/whatsapp/evolution.service.ts`, adicionar após `sendText`:
```typescript
  async sendMedia(
    token: string,
    to: string,
    mediaUrl: string,
    mediaType: 'image' | 'video' | 'audio' | 'document',
    fileName: string,
    caption?: string,
  ): Promise<void> {
    // Evolution Go endpoint: POST /send/media — exige number, mediatype, media (URL).
    const res = await fetch(`${this.baseUrl}/send/media`, {
      method: 'POST',
      headers: this.instanceHeaders(token),
      body: JSON.stringify({
        number: to,
        mediatype: mediaType,
        media: mediaUrl,
        fileName,
        caption: caption ?? '',
        formatJid: true,
      }),
    });
    if (!res.ok) throw new Error(`Evolution sendMedia failed: ${res.status} ${await res.text()}`);
  }
```

- [ ] **Step 3: Adicionar `sendMediaMessage` ao WhatsAppService**

Em `apps/api/src/modules/whatsapp/whatsapp.service.ts`, adicionar após `sendMessage` (espelhando o padrão dele — resolver contact_number via supabase com RLS, chamar evolution, persistir):
```typescript
  async sendMediaMessage(
    userId: string,
    conversationId: string,
    mediaUrl: string,
    mediaType: 'image' | 'video' | 'audio' | 'document',
    fileName: string,
    caption?: string,
  ): Promise<void> {
    const user = await this.getUserRow(userId);
    if (!user.evolution_instance_token) throw new BadRequestException('WhatsApp não está conectado');

    const { data: conv, error: convErr } = await this.supabase
      .from('conversations')
      .select('contact_number')
      .eq('id', conversationId)
      .single();
    if (convErr || !conv) throw new BadRequestException('Conversa não encontrada');

    const to = (conv as { contact_number: string }).contact_number;
    await this.evolution.sendMedia(user.evolution_instance_token, to, mediaUrl, mediaType, fileName, caption);

    const now = new Date().toISOString();
    await this.supabase.from('messages').insert({
      conversation_id: conversationId,
      direction: 'out',
      content: caption || fileName,
      message_type: mediaType,
      media_url: mediaUrl,
      sent_at: now,
    });

    await this.supabase
      .from('conversations')
      .update({ last_message_at: now })
      .eq('id', conversationId);
  }
```
NOTA: verificar como `sendMessage` atualiza `last_message_at`/persiste e seguir exatamente o mesmo padrão (campos, nomes). Se `sendMessage` não atualiza `conversations.last_message_at`, omitir esse trecho para manter consistência.

- [ ] **Step 4: Adicionar endpoint no controller**

Em `apps/api/src/modules/whatsapp/whatsapp.controller.ts`:
- Importar o DTO no topo: `import { SendMediaDto } from './dto/send-media.dto';`
- Adicionar método (espelhando o `send` existente, mesmo guard/try-catch):
```typescript
  @Post('send-media')
  async sendMedia(@CurrentUser() user: User, @Body() dto: SendMediaDto) {
    try {
      await this.whatsapp.sendMediaMessage(user.id, dto.conversationId, dto.mediaUrl, dto.mediaType, dto.fileName, dto.caption);
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`send-media failed for ${user.id}: ${msg}`);
      throw new InternalServerErrorException(msg);
    }
  }
```
NOTA: confirmar que `InternalServerErrorException` e `Body`/`Post`/`CurrentUser` já estão importados (o método `send` usa o mesmo conjunto); ajustar imports se faltar.

- [ ] **Step 5: Build da API**

Run: `pnpm --filter @crmwhats/api build`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/whatsapp/dto/send-media.dto.ts apps/api/src/modules/whatsapp/evolution.service.ts apps/api/src/modules/whatsapp/whatsapp.service.ts apps/api/src/modules/whatsapp/whatsapp.controller.ts
git commit -m "feat(whatsapp): add POST /send-media endpoint (image/video/audio/document via URL)"
```

---

### Task 5: Frontend — layout split + estado de seleção

**Files:**
- Modify: `apps/web/src/app/(app)/meu-numero/page.tsx`

- [ ] **Step 1: Adicionar estado de seleção**

Junto aos outros `useState` do componente (após `hoveredId`):
```typescript
const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
```

- [ ] **Step 2: Importar o painel (será criado na Task 6)**

No topo do arquivo, junto aos imports:
```typescript
import { ConversationPanel } from './ConversationPanel';
```

- [ ] **Step 3: Tornar a aba Conversas full-width e split**

O container raiz da página hoje é `<div style={{ padding: '32px', flex: 1, maxWidth: 800 }}>`. Para a aba conversas usar largura total:
- Quando `tab === 'conversas'`, o wrapper externo NÃO deve limitar a 800px. Alterar o style raiz para condicional:
```typescript
<div style={{ padding: '32px', flex: 1, maxWidth: tab === 'conversas' ? 'none' : 800, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
```

- [ ] **Step 4: Envolver a aba conversas num flex de 2 colunas**

Localizar o bloco `{tab === 'conversas' && ( <div style={{ ...lista... }}> ... </div> )}`. Envolvê-lo num container split e adicionar o painel à direita. Substituir a abertura do bloco por:
```tsx
{tab === 'conversas' && (
  <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0, height: 'calc(100vh - 200px)' }}>
    {/* Coluna esquerda — lista (largura fixa) */}
    <div style={{ width: 360, flexShrink: 0, display: (selectedConvId && typeof window !== 'undefined' && window.innerWidth < 760) ? 'none' : 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--ammoc-paper)', border: '1px solid var(--ammoc-line-2)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      {/* (conteúdo atual da lista: header sync + busca + lista rolável) */}
```
E o fechamento do `<div>` da lista passa a fechar essa coluna esquerda; logo após, adicionar a coluna direita e fechar o container split:
```tsx
    </div>
    {/* Coluna direita — painel */}
    <div style={{ flex: 1, minWidth: 0, display: 'flex', border: '1px solid var(--ammoc-line-2)', borderRadius: 'var(--radius)', overflow: 'hidden', background: 'var(--ammoc-paper)' }}>
      {selectedConvId ? (
        (() => {
          const sel = conversations.find(c => c.id === selectedConvId);
          if (!sel) return null;
          return (
            <ConversationPanel
              conversationId={sel.id}
              contactName={sel.contact_name || sel.contact_number}
              contactNumber={sel.contact_number}
              avatarUrl={avatars[sel.contact_number] ?? null}
              token={token}
              onBack={() => setSelectedConvId(null)}
            />
          );
        })()
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ammoc-ink-400)', fontSize: 14, flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 40 }}>💬</div>
          Selecione uma conversa
        </div>
      )}
    </div>
  </div>
)}
```
NOTA: a lista rolável interna deve ter `overflow-y:auto` e `flex:1` para rolar dentro da coluna. Ajustar o container da lista de conversas (o `<div>` que mapeia `filtered`) para `style={{ overflowY: 'auto', flex: 1 }}` se ainda não tiver.

- [ ] **Step 5: Tornar cada linha clicável**

Na `<div>` de cada `conv` (a que tem `onMouseEnter`), adicionar `onClick` e cursor/destaque:
```tsx
onClick={() => setSelectedConvId(conv.id)}
```
E no `style` da linha, trocar `cursor: 'default'` por `cursor: 'pointer'`, e o `background` para refletir seleção:
```tsx
background: selectedConvId === conv.id ? 'var(--ammoc-green-100)' : (isHovered ? 'var(--ammoc-paper-2)' : 'transparent'),
```
NOTA: o botão "Compartilhar" dentro da linha deve chamar `e.stopPropagation()` no `onClick` para não selecionar a conversa ao compartilhar. Adicionar `onClick={(e) => { e.stopPropagation(); void handleShare(conv.id); }}`.

- [ ] **Step 6: TypeScript check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: sem erros. (Vai falhar até a Task 6 criar `ConversationPanel`; se executado isoladamente, criar primeiro a Task 6 ou aceitar o erro de import até lá. Recomendado: executar Task 6 junto/antes do tsc final.)

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/(app)/meu-numero/page.tsx"
git commit -m "feat(meu-numero): split 2-column layout + conversation selection"
```

---

### Task 6: Frontend — ConversationPanel (histórico + texto + poll)

**Files:**
- Create: `apps/web/src/app/(app)/meu-numero/ConversationPanel.tsx`

- [ ] **Step 1: Criar o componente com histórico, poll e envio de texto**

`apps/web/src/app/(app)/meu-numero/ConversationPanel.tsx`:
```tsx
'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';

const API = process.env.NEXT_PUBLIC_API_URL ?? '';

interface Message {
  id: string;
  conversation_id: string;
  direction: 'in' | 'out';
  content: string;
  message_type: string;
  media_url: string | null;
  sent_at: string;
}

interface Props {
  conversationId: string;
  contactName: string;
  contactNumber: string;
  avatarUrl: string | null;
  token: string | null;
  onBack?: () => void;
}

export function ConversationPanel({ conversationId, contactName, contactNumber, avatarUrl, token, onBack }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const loadMessages = useCallback(async () => {
    const { data } = await supabase
      .from('messages')
      .select('id, conversation_id, direction, content, message_type, media_url, sent_at')
      .eq('conversation_id', conversationId)
      .order('sent_at', { ascending: true });
    setMessages((data ?? []) as Message[]);
    setLoading(false);
  }, [supabase, conversationId]);

  // Load + poll every 5s
  useEffect(() => {
    setLoading(true);
    void loadMessages();
    const iv = setInterval(() => { void loadMessages(); }, 5000);
    return () => clearInterval(iv);
  }, [loadMessages]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  async function handleSendText() {
    if (!token || !text.trim() || sending) return;
    setSending(true); setError(null);
    const body = text.trim();
    setText('');
    try {
      const res = await fetch(`${API}/api/whatsapp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ conversationId, text: body }),
      });
      if (!res.ok) throw new Error(await res.text());
      await loadMessages();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao enviar');
      setText(body);
    }
    setSending(false);
  }

  const initials = contactName.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase().slice(0, 2);

  const fmtTime = (ts: string) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--ammoc-line-2)', background: 'var(--ammoc-paper-2)' }}>
        {onBack && (
          <button type="button" onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--ammoc-ink-600)', padding: 0, marginRight: 2 }}>←</button>
        )}
        <div style={{ width: 38, height: 38, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: 'var(--ammoc-green)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 14 }}>
          {avatarUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={avatarUrl} alt={contactName} style={{ width: 38, height: 38, objectFit: 'cover' }} />
            : (initials || '?')}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ammoc-ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contactName}</div>
          <div style={{ fontSize: 11, color: 'var(--ammoc-ink-400)' }}>{contactNumber}</div>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--ammoc-surface, #f7f5f0)' }}>
        {loading ? (
          <div style={{ margin: 'auto', color: 'var(--ammoc-ink-400)', fontSize: 13 }}>Carregando…</div>
        ) : messages.length === 0 ? (
          <div style={{ margin: 'auto', color: 'var(--ammoc-ink-400)', fontSize: 13, fontStyle: 'italic' }}>Sem mensagens ainda</div>
        ) : messages.map(m => {
          const out = m.direction === 'out';
          return (
            <div key={m.id} style={{ alignSelf: out ? 'flex-end' : 'flex-start', maxWidth: '72%', background: out ? 'var(--ammoc-green-100)' : 'white', border: '1px solid var(--ammoc-line-2)', borderRadius: 10, padding: '6px 10px' }}>
              {m.media_url && m.message_type === 'image' && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.media_url} alt={m.content} style={{ maxWidth: 240, borderRadius: 6, display: 'block', marginBottom: 4 }} />
              )}
              {m.media_url && m.message_type === 'video' && (
                <video src={m.media_url} controls style={{ maxWidth: 240, borderRadius: 6, display: 'block', marginBottom: 4 }} />
              )}
              {m.media_url && m.message_type === 'audio' && (
                <audio src={m.media_url} controls style={{ display: 'block', marginBottom: 4 }} />
              )}
              {m.media_url && m.message_type === 'document' && (
                <a href={m.media_url} target="_blank" rel="noreferrer" style={{ display: 'block', marginBottom: 4, color: 'var(--ammoc-green-700)', fontSize: 13, fontWeight: 600 }}>📎 {m.content}</a>
              )}
              {(m.message_type === 'text' || (!m.media_url && m.content)) && (
                <div style={{ fontSize: 13, color: 'var(--ammoc-ink-900)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.content}</div>
              )}
              <div style={{ fontSize: 10, color: 'var(--ammoc-ink-400)', textAlign: 'right', marginTop: 2 }}>{fmtTime(m.sent_at)}</div>
            </div>
          );
        })}
      </div>

      {error && <div style={{ padding: '6px 16px', fontSize: 12, color: '#b91c1c', background: '#fef2f2' }}>{error}</div>}

      {/* Composer (texto; mídia adicionada na Task 7) */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, padding: '10px 12px', borderTop: '1px solid var(--ammoc-line-2)', background: 'var(--ammoc-paper-2)' }}>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSendText(); } }}
          placeholder="Digite uma mensagem…"
          rows={1}
          style={{ flex: 1, resize: 'none', border: '1px solid var(--ammoc-line)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: 13, fontFamily: 'var(--font-body)', outline: 'none', maxHeight: 120, color: 'var(--ammoc-ink-900)', background: 'var(--ammoc-paper)' }}
        />
        <button type="button" onClick={() => void handleSendText()} disabled={sending || !text.trim()} style={{ background: 'var(--ammoc-green)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: sending || !text.trim() ? 'default' : 'pointer', opacity: !text.trim() ? 0.5 : 1, flexShrink: 0 }}>
          {sending ? '…' : 'Enviar'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: sem erros (com a Task 5 já aplicada).

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(app)/meu-numero/ConversationPanel.tsx"
git commit -m "feat(meu-numero): ConversationPanel — message history, polling, text send"
```

---

### Task 7: Frontend — anexar/enviar mídia + render

**Files:**
- Modify: `apps/web/src/app/(app)/meu-numero/ConversationPanel.tsx`

- [ ] **Step 1: Adicionar estado de upload + helper de tipo**

Dentro do componente, junto aos outros `useState`:
```typescript
const [uploading, setUploading] = useState(false);
const fileInputRef = useRef<HTMLInputElement | null>(null);
```
E uma função helper (fora do componente, no topo do arquivo):
```typescript
function mediaTypeFromMime(mime: string): 'image' | 'video' | 'audio' | 'document' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}
```

- [ ] **Step 2: Adicionar handler de upload + envio de mídia**

Dentro do componente:
```typescript
async function handleFile(file: File) {
  if (!token) return;
  if (file.size > 26214400) { setError('Arquivo excede 25 MB'); return; }
  setUploading(true); setError(null);
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) throw new Error('Sessão expirada');
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${uid}/${conversationId}/${Date.now()}-${safe}`;
    const up = await supabase.storage.from('wa-media').upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) throw new Error(up.error.message);
    const { data: pub } = supabase.storage.from('wa-media').getPublicUrl(path);
    const mediaUrl = pub.publicUrl;
    const mediaType = mediaTypeFromMime(file.type);
    const res = await fetch(`${API}/api/whatsapp/send-media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ conversationId, mediaUrl, mediaType, fileName: file.name, caption: text.trim() || undefined }),
    });
    if (!res.ok) throw new Error(await res.text());
    setText('');
    await loadMessages();
  } catch (e) {
    setError(e instanceof Error ? e.message : 'Erro ao enviar mídia');
  }
  setUploading(false);
}
```

- [ ] **Step 3: Adicionar botão de anexo + input ao composer**

No composer (antes do `<textarea>`), adicionar:
```tsx
<input
  ref={fileInputRef}
  type="file"
  accept="image/*,video/*,audio/*,application/pdf,application/*"
  style={{ display: 'none' }}
  onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ''; }}
/>
<button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} title="Anexar mídia" style={{ background: 'var(--ammoc-paper)', border: '1px solid var(--ammoc-line)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', fontSize: 16, cursor: uploading ? 'default' : 'pointer', flexShrink: 0 }}>
  {uploading ? '…' : '📎'}
</button>
```

- [ ] **Step 4: TypeScript check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(app)/meu-numero/ConversationPanel.tsx"
git commit -m "feat(meu-numero): attach + send media via Supabase Storage"
```

---

### Task 8: Deploy + verificação

- [ ] **Step 1: Push**

```bash
git push origin master
```

- [ ] **Step 2: Deploy API + Web (Coolify)**

```bash
curl -s "http://2.25.139.166:8000/api/v1/deploy?uuid=pp6qewlm9usx4rqroaxzi042&force=false" -H "Authorization: Bearer 4|eapzDjDej8MwupomynOjKRtnV94SWwZM4ds9EK8s51423d3e"
curl -s "http://2.25.139.166:8000/api/v1/deploy?uuid=y664pro58rjywtieei0no3ua&force=false" -H "Authorization: Bearer 4|eapzDjDej8MwupomynOjKRtnV94SWwZM4ds9EK8s51423d3e"
```

- [ ] **Step 3: Verificar API no ar**

Aguardar `/api/sectors` ou `/api/health` responder no host `pp6qewlm9usx4rqroaxzi042.2.25.139.166.sslip.io`. Confirmar que `/api/whatsapp/send-media` existe (POST sem auth → 401, não 404).

- [ ] **Step 4: Verificar Web (HTTPS)**

Aguardar `https://crm.ammoc.org.br/login` → 200. (Web servido por HTTPS via Coolify; ver [[coolify-deploy-https]].)

- [ ] **Step 5: Smoke test manual**
  - Logar em `https://crm.ammoc.org.br`, ir em Meu Número → Minhas Conversas.
  - Verificar: fotos dos contatos aparecem (ao menos os com foto pública).
  - Clicar num contato → painel abre à direita com histórico.
  - Enviar uma mensagem de texto → aparece na hora.
  - Anexar uma imagem e um documento → enviados e renderizados no painel.

---

## Self-Review

**Cobertura da spec:**
- ✅ Split 2 colunas (Task 5)
- ✅ Painel: histórico + bolhas + poll (Task 6)
- ✅ Envio de texto (Task 6, endpoint já existia)
- ✅ Envio de mídia via Storage (Tasks 3, 4, 7)
- ✅ Render de mídia enviada (Task 6/7)
- ✅ media_url em messages (Task 2)
- ✅ Fotos de contato (Task 1 — fix do JID, verificado ao vivo)
- ✅ Responsivo (Task 5 — coluna esquerda oculta em <760px com botão voltar)

**Placeholders:** nenhum — endpoints confirmados ao vivo; código completo em cada step.

**Consistência de tipos:** `Message` (Task 6) usa `media_url` (Task 2). `mediaType` ∈ image|video|audio|document consistente entre DTO (Task 4), `sendMedia` (Task 4) e `mediaTypeFromMime` (Task 7). Endpoint `/api/whatsapp/send-media` e payload `{conversationId, mediaUrl, mediaType, fileName, caption?}` consistentes entre Task 4 (DTO) e Task 7 (fetch).

**Fora de escopo (confirmado):** mídia recebida (mostra "[mídia]"), gravação por microfone, realtime websocket.
