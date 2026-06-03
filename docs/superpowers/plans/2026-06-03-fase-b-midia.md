# Fase B — Mídia (recepção nos 2 canais + envio pelo Canal) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Receber mídia (imagem/áudio/vídeo/documento) com download e exibição nos canais Evolution (`/meu-numero`) e Meta (`/canal`), e permitir enviar mídia pela inbox do Canal.

**Architecture:** Pipeline assíncrono (Abordagem B): o webhook grava a mensagem na hora com `message_type` correto e `media_url` nulo, responde 200 rápido e dispara um download em background que sobe os bytes pro bucket `wa-media` e faz `UPDATE` do `media_url`. O poll de 5s já existente exibe a mídia quando pronta.

**Tech Stack:** NestJS (API), Next.js (web), Supabase (Postgres + Storage `wa-media` público), Evolution Go (`POST /message/downloadimage`, resposta `data.base64` = data-URL), Meta Cloud API (Graph v21.0). Testes Jest (padrão `*.spec.ts`).

**Contratos confirmados:**
- Evolution Go `POST /message/downloadimage`, body `{ "message": <objeto Message inteiro do webhook> }`, resposta `{ message:"success", data:{ base64: "data:<mime>;base64,<...>" } }`.
- Meta download: `GET https://graph.facebook.com/v21.0/<media-id>` (Bearer) → `{ url, mime_type }`; depois `GET <url>` (Bearer) → bytes.
- Meta envio: `POST /<phoneNumberId>/messages` com `type` em `image|audio|video|document` e `{ link, caption?, filename? }`.

**File Structure:**
- Modificar `apps/api/src/modules/whatsapp/evolution.service.ts` — método `downloadMedia`.
- Modificar `apps/api/src/modules/whatsapp/webhook.service.ts` — detectar mídia + background download.
- Modificar `apps/api/src/modules/whatsapp/whatsapp.module.ts` — injetar `EvolutionService` no `WebhookService`.
- Criar `apps/api/src/common/mime.ts` — helper `mimeToExt` + `parseDataUrl` (compartilhado API).
- Modificar `apps/api/src/modules/canal/meta.service.ts` — `downloadMedia`, `sendMedia`.
- Modificar `apps/api/src/modules/canal/canal-conversation.service.ts` — `ingestInbound` estendido + background + `sendMediaMessage`.
- Modificar `apps/api/src/modules/canal/canal-webhook.controller.ts` — parse de mídia.
- Criar `apps/api/src/modules/canal/dto/send-media.dto.ts`.
- Modificar `apps/api/src/modules/canal/canal-inbox.controller.ts` — endpoint `send-media`.
- Modificar `packages/types/src/index.ts` — `CanalMessage` com `message_type`/`media_url`.
- Modificar `apps/web/src/app/(app)/canal/CanalPanel.tsx` — render de mídia + composer com upload.
- Modificar `apps/web/src/app/(app)/meu-numero/ConversationPanel.tsx` — placeholder "baixando…".
- Migração Supabase (via MCP `apply_migration`) — colunas em `canal_messages`.

---

### Task 1: Migração — colunas de mídia em `canal_messages`

**Files:**
- DB: aplicar migração via MCP `mcp__supabase__apply_migration` (projeto ref `xfqphbdurynuwvrnxpvj`).

- [ ] **Step 1: Aplicar a migração**

Chamar `mcp__supabase__apply_migration` com `name: "canal_messages_media"` e query:

```sql
alter table public.canal_messages
  add column if not exists message_type public.message_type not null default 'text',
  add column if not exists media_url text;
```

- [ ] **Step 2: Verificar**

Chamar `mcp__supabase__execute_sql`:

```sql
select column_name from information_schema.columns
where table_name = 'canal_messages' and column_name in ('message_type','media_url');
```

Esperado: duas linhas (`message_type`, `media_url`).

- [ ] **Step 3: Commit (registro da migração no histórico do repo)**

```bash
git commit --allow-empty -m "feat(db): canal_messages.message_type + media_url (via MCP)"
```

---

### Task 2: Helper compartilhado `mime.ts`

**Files:**
- Create: `apps/api/src/common/mime.ts`
- Test: `apps/api/src/common/mime.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

`apps/api/src/common/mime.spec.ts`:

```typescript
import { mimeToExt, parseDataUrl } from './mime';

describe('mimeToExt', () => {
  it('mapeia mimes conhecidos', () => {
    expect(mimeToExt('image/jpeg')).toBe('jpg');
    expect(mimeToExt('image/png')).toBe('png');
    expect(mimeToExt('audio/ogg; codecs=opus')).toBe('ogg');
    expect(mimeToExt('application/pdf')).toBe('pdf');
    expect(mimeToExt('video/mp4')).toBe('mp4');
  });
  it('faz fallback para bin', () => {
    expect(mimeToExt('application/x-coisa')).toBe('bin');
    expect(mimeToExt('')).toBe('bin');
  });
});

describe('parseDataUrl', () => {
  it('separa mime e bytes de um data-url base64', () => {
    // "hi" em base64 = aGk=
    const r = parseDataUrl('data:text/plain;base64,aGk=');
    expect(r).not.toBeNull();
    expect(r!.mime).toBe('text/plain');
    expect(r!.buffer.toString('utf8')).toBe('hi');
  });
  it('retorna null para entrada inválida', () => {
    expect(parseDataUrl('nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/api && npx jest src/common/mime.spec.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

`apps/api/src/common/mime.ts`:

```typescript
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'txt',
};

/** Extensão de arquivo a partir do mimetype (ignora parâmetros como `; codecs=opus`). */
export function mimeToExt(mime: string): string {
  const base = (mime || '').split(';')[0].trim().toLowerCase();
  return MIME_EXT[base] ?? 'bin';
}

/** Separa um data-url `data:<mime>;base64,<dados>` em mime + Buffer. */
export function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl || '');
  if (!m) return null;
  const mime = m[1];
  const isB64 = !!m[2];
  const buffer = isB64 ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8');
  return { mime, buffer };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd apps/api && npx jest src/common/mime.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/mime.ts apps/api/src/common/mime.spec.ts
git commit -m "feat(api): helper mimeToExt + parseDataUrl"
```

---

### Task 3: `EvolutionService.downloadMedia`

**Files:**
- Modify: `apps/api/src/modules/whatsapp/evolution.service.ts`
- Test: `apps/api/src/modules/whatsapp/evolution.service.spec.ts` (já existe — adicionar caso)

- [ ] **Step 1: Escrever o teste que falha**

Adicionar em `apps/api/src/modules/whatsapp/evolution.service.spec.ts` (dentro do `describe` existente; se não houver, criar o arquivo com o mesmo padrão de construção via `ConfigService` mock):

```typescript
it('downloadMedia retorna o data-url base64 da resposta', async () => {
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ message: 'success', data: { base64: 'data:image/jpeg;base64,aGk=' } }),
  } as Response);
  // `service` é a instância de EvolutionService já criada no beforeEach do arquivo
  const out = await service.downloadMedia('tok-1', { imageMessage: { url: 'x' } });
  expect(out).toBe('data:image/jpeg;base64,aGk=');
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining('/message/downloadimage'),
    expect.objectContaining({ method: 'POST' }),
  );
  fetchMock.mockRestore();
});
```

> Se `evolution.service.spec.ts` ainda não constrói `service`, criar `beforeEach` com:
> `service = new EvolutionService({ getOrThrow: (k: string) => k === 'evolution.url' ? 'http://evo' : 'KEY' } as unknown as ConfigService);`

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/api && npx jest src/modules/whatsapp/evolution.service.spec.ts`
Expected: FAIL (`downloadMedia is not a function`).

- [ ] **Step 3: Implementar**

Adicionar o método em `apps/api/src/modules/whatsapp/evolution.service.ts` (após `sendMedia`):

```typescript
  /**
   * Baixa (e decripta) uma mídia recebida. `mediaMessage` é o objeto `Message`
   * exatamente como veio no webhook (contém imageMessage/audioMessage/etc com
   * url/mediaKey/directPath). Evolution Go responde com data.base64 = data-url.
   * Retorna o data-url (`data:<mime>;base64,...`) ou null em falha.
   */
  async downloadMedia(token: string, mediaMessage: unknown): Promise<string | null> {
    const res = await fetch(`${this.baseUrl}/message/downloadimage`, {
      method: 'POST',
      headers: this.instanceHeaders(token),
      body: JSON.stringify({ message: mediaMessage }),
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => ({}))) as { data?: { base64?: string } };
    return body.data?.base64 ?? null;
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd apps/api && npx jest src/modules/whatsapp/evolution.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/whatsapp/evolution.service.ts apps/api/src/modules/whatsapp/evolution.service.spec.ts
git commit -m "feat(api): EvolutionService.downloadMedia (POST /message/downloadimage)"
```

---

### Task 4: Webhook Evolution — detectar mídia + download em background

**Files:**
- Modify: `apps/api/src/modules/whatsapp/webhook.service.ts`
- Modify: `apps/api/src/modules/whatsapp/whatsapp.module.ts` (injetar `EvolutionService`)
- Test: `apps/api/src/modules/whatsapp/webhook.service.spec.ts`

- [ ] **Step 1: Injetar `EvolutionService` no `WebhookService`**

Em `webhook.service.ts`, alterar o construtor e imports:

```typescript
import { EvolutionService } from './evolution.service';
import { mimeToExt, parseDataUrl } from '../../common/mime';
// ...
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly evolution: EvolutionService,
  ) {}
```

Em `whatsapp.module.ts`, atualizar a factory do `WebhookService`:

```typescript
    {
      provide: WebhookService,
      inject: ['SUPABASE_CLIENT', EvolutionService],
      useFactory: (
        supabase: ReturnType<typeof createClient>,
        evo: EvolutionService,
      ) => new WebhookService(supabase, evo),
    },
```

- [ ] **Step 2: Atualizar o teste existente (construtor) + adicionar teste de detecção de tipo**

Em `webhook.service.spec.ts`, atualizar a criação do serviço e adicionar um mock de `EvolutionService`:

```typescript
import { EvolutionService } from './evolution.service';
// ...
const makeEvolution = () => ({
  downloadMedia: jest.fn().mockResolvedValue('data:image/jpeg;base64,aGk='),
} as unknown as EvolutionService);

// no beforeEach:
service = new WebhookService(supa, makeEvolution());
```

Adicionar teste de que uma imagem é gravada com `message_type: 'image'`:

```typescript
it('grava mensagem de imagem recebida com message_type image', async () => {
  // user lookup → id
  const single = jest.fn()
    .mockResolvedValueOnce({ data: { id: 'user-1' }, error: null }); // users
  const upsertConv = jest.fn().mockReturnValue({
    select: () => ({ single: jest.fn().mockResolvedValue({ data: { id: 'conv-1' }, error: null }) }),
  });
  const upsertMsg = jest.fn().mockResolvedValue({ error: null });
  const update = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });
  (supa.from as jest.Mock).mockImplementation((table: string) => {
    if (table === 'users') return { select: () => ({ eq: () => ({ single }) }) };
    if (table === 'conversations') return { upsert: upsertConv };
    if (table === 'messages') return { upsert: upsertMsg, update };
    return {};
  });

  await service.handleEvent('tok-1', {
    event: 'Message',
    data: {
      Info: { Chat: '5547999@s.whatsapp.net', ID: 'M1', IsFromMe: false, PushName: 'Fulano' },
      Message: { imageMessage: { caption: 'oi', url: 'x', mediaKey: 'k' } },
    },
  });

  expect(upsertMsg).toHaveBeenCalledWith(
    expect.objectContaining({ message_type: 'image', content: 'oi' }),
    expect.anything(),
  );
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd apps/api && npx jest src/modules/whatsapp/webhook.service.spec.ts`
Expected: FAIL (grava `message_type: 'text'` hoje).

- [ ] **Step 4: Implementar detecção de tipo + background download**

Em `webhook.service.ts`, dentro de `handleMessage`, substituir o trecho de extração de conteúdo (linhas ~66-76) para também detectar tipo e mídia:

```typescript
    // Tipos de mídia (whatsmeow proto / Baileys; camelCase no Message interno).
    const audioMsg = pick(message, 'audioMessage', 'AudioMessage') as Record<string, unknown> | undefined;
    const docMsg = pick(message, 'documentMessage', 'DocumentMessage') as Record<string, unknown> | undefined;
    const stickerMsg = pick(message, 'stickerMessage', 'StickerMessage') as Record<string, unknown> | undefined;

    let messageType: 'text' | 'image' | 'video' | 'audio' | 'document' = 'text';
    if (imgMsg || stickerMsg) messageType = 'image';
    else if (vidMsg) messageType = 'video';
    else if (audioMsg) messageType = 'audio';
    else if (docMsg) messageType = 'document';

    const docFileName = pick(docMsg, 'fileName', 'FileName', 'title', 'Title') as string | undefined;
    const content = (
      (pick(message, 'conversation', 'Conversation') as string | undefined) ??
      (pick(extText, 'text', 'Text') as string | undefined) ??
      (pick(imgMsg, 'caption', 'Caption') as string | undefined) ??
      (pick(vidMsg, 'caption', 'Caption') as string | undefined) ??
      (pick(docMsg, 'caption', 'Caption') as string | undefined) ??
      docFileName ??
      ''
    );
```

Trocar o upsert da mensagem (linhas ~147-157) por:

```typescript
    const { error: msgError } = await this.supabase.from('messages').upsert(
      {
        conversation_id: convId,
        direction,
        content: content || (messageType === 'text' ? '[mídia]' : ''),
        message_type: messageType,
        evolution_message_id: messageId,
        sent_at: sentAt,
      },
      { onConflict: 'evolution_message_id', ignoreDuplicates: true },
    );
    if (msgError) {
      this.logger.error(`DB error upserting message: ${msgError.message}`);
      return;
    }
    this.logger.log(`Message saved — conv:${convId} dir:${direction} type:${messageType}`);

    // Mídia recebida: baixa em background e atualiza media_url quando pronto.
    if (messageType !== 'text' && direction === 'in') {
      void this.downloadAndStoreEvolution(
        token, message, messageType,
        (userRow as { id: string }).id, convId, messageId,
      ).catch((e) =>
        this.logger.warn(`Falha download mídia ${messageId}: ${e instanceof Error ? e.message : String(e)}`),
      );
    }
```

Adicionar o método privado ao final da classe:

```typescript
  private async downloadAndStoreEvolution(
    token: string,
    message: Record<string, unknown> | undefined,
    messageType: string,
    ownerUserId: string,
    conversationId: string,
    messageId: string,
  ): Promise<void> {
    const dataUrl = await this.evolution.downloadMedia(token, message);
    if (!dataUrl) { this.logger.warn(`downloadMedia vazio p/ ${messageId}`); return; }
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) { this.logger.warn(`data-url inválido p/ ${messageId}`); return; }
    const ext = mimeToExt(parsed.mime);
    const safeId = messageId.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `incoming/${ownerUserId}/${conversationId}/${safeId}.${ext}`;
    const up = await this.supabase.storage
      .from('wa-media')
      .upload(path, parsed.buffer, { contentType: parsed.mime, upsert: true });
    if (up.error) { this.logger.error(`upload storage falhou: ${up.error.message}`); return; }
    const { data: pub } = this.supabase.storage.from('wa-media').getPublicUrl(path);
    await this.supabase.from('messages')
      .update({ media_url: pub.publicUrl })
      .eq('evolution_message_id', messageId);
    this.logger.log(`Mídia salva ${messageId} → ${path}`);
  }
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd apps/api && npx jest src/modules/whatsapp/webhook.service.spec.ts`
Expected: PASS (todos os casos, inclusive os antigos).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/whatsapp/webhook.service.ts apps/api/src/modules/whatsapp/webhook.service.spec.ts apps/api/src/modules/whatsapp/whatsapp.module.ts
git commit -m "feat(api): webhook Evolution detecta mídia + download em background"
```

---

### Task 5: `MetaService.downloadMedia` + `sendMedia`

**Files:**
- Modify: `apps/api/src/modules/canal/meta.service.ts`
- Test: `apps/api/src/modules/canal/meta.service.spec.ts` (criar se não existir)

- [ ] **Step 1: Escrever os testes que falham**

Criar/!editar `apps/api/src/modules/canal/meta.service.spec.ts`:

```typescript
import { MetaService } from './meta.service';
import { SupabaseClient } from '@supabase/supabase-js';

const supaWithToken = () => ({
  from: () => ({
    select: () => ({ limit: () => ({ single: async () => ({ data: { access_token: 'TK', app_secret: '', verify_token: 'v' } }) }) }),
  }),
} as unknown as SupabaseClient);

describe('MetaService media', () => {
  let svc: MetaService;
  beforeEach(() => { svc = new MetaService(supaWithToken()); });
  afterEach(() => jest.restoreAllMocks());

  it('downloadMedia faz GET do id, depois GET da url e devolve mime+buffer', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ url: 'https://lookaside/x', mime_type: 'image/png' }) } as Response)
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new Uint8Array([1,2,3]).buffer } as Response);
    const out = await svc.downloadMedia('MID');
    expect(out).not.toBeNull();
    expect(out!.mime).toBe('image/png');
    expect(Buffer.isBuffer(out!.buffer)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sendMedia envia type image com link/caption', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.X' }] }) } as Response);
    const r = await svc.sendMedia('PN1', '5549999', 'image', 'https://pub/x.jpg', 'leg', undefined);
    expect(r.ok).toBe(true);
    expect(r.wa_message_id).toBe('wamid.X');
    const sentBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(sentBody.type).toBe('image');
    expect(sentBody.image.link).toBe('https://pub/x.jpg');
    expect(sentBody.image.caption).toBe('leg');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/api && npx jest src/modules/canal/meta.service.spec.ts`
Expected: FAIL (`downloadMedia`/`sendMedia` não existem).

- [ ] **Step 3: Implementar**

Adicionar em `meta.service.ts` (após `sendText`):

```typescript
  /** Baixa mídia recebida: GET /{mediaId} → url temporária → GET url (Bearer). */
  async downloadMedia(mediaId: string): Promise<{ mime: string; buffer: Buffer } | null> {
    const cfg = await this.config();
    if (!cfg?.access_token) return null;
    const auth = { Authorization: `Bearer ${cfg.access_token}` };
    const metaRes = await fetch(`${GRAPH}/${mediaId}`, { headers: auth });
    if (!metaRes.ok) { this.logger.warn(`Meta media meta ${mediaId}: ${metaRes.status}`); return null; }
    const meta = (await metaRes.json().catch(() => ({}))) as { url?: string; mime_type?: string };
    if (!meta.url) return null;
    const binRes = await fetch(meta.url, { headers: auth });
    if (!binRes.ok) { this.logger.warn(`Meta media bin ${mediaId}: ${binRes.status}`); return null; }
    const buffer = Buffer.from(await binRes.arrayBuffer());
    return { mime: meta.mime_type ?? 'application/octet-stream', buffer };
  }

  /** Envia mídia por link público (image/audio/video/document). */
  async sendMedia(
    phoneNumberId: string,
    to: string,
    type: 'image' | 'audio' | 'video' | 'document',
    link: string,
    caption?: string,
    filename?: string,
  ): Promise<MetaSendResult> {
    const cfg = await this.config();
    if (!cfg?.access_token)
      return { ok: false, error: 'Canal não configurado (access_token ausente)' };
    const media: Record<string, unknown> = { link };
    if (caption && type !== 'audio') media.caption = caption;
    if (filename && type === 'document') media.filename = filename;
    const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type,
        [type]: media,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      messages?: Array<{ id: string }>;
      error?: { message: string };
    };
    if (!res.ok)
      return { ok: false, error: body.error?.message ?? `Graph ${res.status}` };
    return { ok: true, wa_message_id: body.messages?.[0]?.id };
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd apps/api && npx jest src/modules/canal/meta.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/canal/meta.service.ts apps/api/src/modules/canal/meta.service.spec.ts
git commit -m "feat(api): MetaService.downloadMedia + sendMedia"
```

---

### Task 6: Webhook Canal — parse de mídia + ingest estendido + background

**Files:**
- Modify: `apps/api/src/modules/canal/canal-webhook.controller.ts`
- Modify: `apps/api/src/modules/canal/canal-conversation.service.ts`
- Test: `apps/api/src/modules/canal/canal-conversation.service.spec.ts` (criar)

- [ ] **Step 1: Escrever o teste que falha (ingestInbound grava tipo de mídia)**

Criar `apps/api/src/modules/canal/canal-conversation.service.spec.ts`:

```typescript
import { CanalConversationService } from './canal-conversation.service';
import { SupabaseClient } from '@supabase/supabase-js';
import { MetaService } from './meta.service';

describe('CanalConversationService.ingestInbound', () => {
  it('grava canal_messages com message_type quando há mídia', async () => {
    const upsertMsg = jest.fn().mockResolvedValue({ error: null });
    const supa = {
      from: jest.fn((table: string) => {
        if (table === 'canal_numbers')
          return { select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'n1', active: true } }) }) }) };
        if (table === 'canal_conversations')
          return { upsert: () => ({ select: () => ({ single: async () => ({ data: { id: 'c1', status: 'open' }, error: null }) }) }), update: () => ({ eq: async () => ({}) }) };
        if (table === 'canal_messages') return { upsert: upsertMsg };
        return {};
      }),
    } as unknown as SupabaseClient;
    const meta = { downloadMedia: jest.fn().mockResolvedValue(null) } as unknown as MetaService;
    const svc = new CanalConversationService(supa, meta);

    await svc.ingestInbound({
      phoneNumberId: 'PN', from: '5549999', name: 'Cidadão',
      waMessageId: 'wamid.1', content: 'foto', tsISO: new Date(0).toISOString(),
      messageType: 'image', mediaId: 'MID', fileName: null,
    });

    expect(upsertMsg).toHaveBeenCalledWith(
      expect.objectContaining({ message_type: 'image', media_url: null }),
      expect.anything(),
    );
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/api && npx jest src/modules/canal/canal-conversation.service.spec.ts`
Expected: FAIL (assinatura de `ingestInbound` não aceita `messageType`).

- [ ] **Step 3: Estender `ingestInbound` + background no service**

Em `canal-conversation.service.ts`, importar o helper:

```typescript
import { mimeToExt } from '../../common/mime';
```

Trocar a assinatura/corpo de `ingestInbound`:

```typescript
  async ingestInbound(params: {
    phoneNumberId: string;
    from: string;
    name: string | null;
    waMessageId: string;
    content: string;
    tsISO: string;
    messageType?: 'text' | 'image' | 'video' | 'audio' | 'document';
    mediaId?: string | null;
    fileName?: string | null;
  }): Promise<void> {
    const messageType = params.messageType ?? 'text';
    // ... (lookup de canal_numbers e upsert da conversa: INALTERADOS) ...
```

No upsert da mensagem (substituir o bloco atual):

```typescript
    await this.supabase.from('canal_messages').upsert(
      {
        conversation_id: c.id,
        direction: 'in',
        content: params.content || (messageType === 'text' ? '[mídia]' : ''),
        message_type: messageType,
        media_url: null,
        wa_message_id: params.waMessageId,
        sent_at: params.tsISO,
      },
      { onConflict: 'wa_message_id', ignoreDuplicates: true },
    );

    if (messageType !== 'text' && params.mediaId) {
      void this.downloadAndStoreCanal(params.mediaId, c.id, params.waMessageId).catch((e) =>
        this.logger.warn(`Canal: falha download mídia ${params.waMessageId}: ${e instanceof Error ? e.message : String(e)}`),
      );
    }
  }

  private async downloadAndStoreCanal(
    mediaId: string,
    conversationId: string,
    waMessageId: string,
  ): Promise<void> {
    const media = await this.meta.downloadMedia(mediaId);
    if (!media) { this.logger.warn(`Canal: downloadMedia vazio ${waMessageId}`); return; }
    const ext = mimeToExt(media.mime);
    const safeId = waMessageId.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `canal/${conversationId}/${safeId}.${ext}`;
    const up = await this.supabase.storage
      .from('wa-media')
      .upload(path, media.buffer, { contentType: media.mime, upsert: true });
    if (up.error) { this.logger.error(`Canal: upload storage falhou: ${up.error.message}`); return; }
    const { data: pub } = this.supabase.storage.from('wa-media').getPublicUrl(path);
    await this.supabase.from('canal_messages')
      .update({ media_url: pub.publicUrl })
      .eq('wa_message_id', waMessageId);
    this.logger.log(`Canal: mídia salva ${waMessageId} → ${path}`);
  }
```

Também atualizar o `select` de `messages()` para devolver as colunas novas (já vem por `select('*')` — sem mudança necessária).

- [ ] **Step 4: Atualizar o parser do webhook controller**

Em `canal-webhook.controller.ts`, ampliar o tipo de `messages` e o loop:

```typescript
          messages?: Array<{
            from: string;
            id: string;
            timestamp: string;
            type: string;
            text?: { body: string };
            image?: { id: string; caption?: string; mime_type?: string };
            video?: { id: string; caption?: string; mime_type?: string };
            audio?: { id: string; mime_type?: string };
            document?: { id: string; caption?: string; filename?: string; mime_type?: string };
            sticker?: { id: string; mime_type?: string };
          }>;
```

Substituir o corpo do `for (const m of value.messages ?? [])`:

```typescript
        for (const m of value.messages ?? []) {
          const tsISO = new Date(Number(m.timestamp) * 1000).toISOString();
          const TYPE_MAP: Record<string, 'image' | 'video' | 'audio' | 'document'> = {
            image: 'image', video: 'video', audio: 'audio', document: 'document', sticker: 'image',
          };
          const messageType = TYPE_MAP[m.type];
          if (!messageType) {
            // texto (ou tipo não suportado → guarda como texto/placeholder)
            await this.convs.ingestInbound({
              phoneNumberId, from: m.from, name,
              waMessageId: m.id, content: m.type === 'text' ? (m.text?.body ?? '') : '[mídia]',
              tsISO,
            });
            continue;
          }
          const media = (m as Record<string, { id?: string; caption?: string; filename?: string }>)[m.type];
          const caption = media?.caption ?? '';
          const fileName = media?.filename ?? null;
          await this.convs.ingestInbound({
            phoneNumberId, from: m.from, name,
            waMessageId: m.id, content: caption || fileName || '',
            tsISO, messageType, mediaId: media?.id ?? null, fileName,
          });
        }
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd apps/api && npx jest src/modules/canal/canal-conversation.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/canal/canal-conversation.service.ts apps/api/src/modules/canal/canal-conversation.service.spec.ts apps/api/src/modules/canal/canal-webhook.controller.ts
git commit -m "feat(api): webhook Canal recebe mídia (parse + download em background)"
```

---

### Task 7: Endpoint de envio de mídia pelo Canal

**Files:**
- Create: `apps/api/src/modules/canal/dto/send-media.dto.ts`
- Modify: `apps/api/src/modules/canal/canal-inbox.controller.ts`
- Modify: `apps/api/src/modules/canal/canal-conversation.service.ts` (método `sendMediaMessage`)
- Test: `apps/api/src/modules/canal/canal-conversation.service.spec.ts` (adicionar caso)

- [ ] **Step 1: Criar a DTO**

`apps/api/src/modules/canal/dto/send-media.dto.ts`:

```typescript
import { IsString, IsNotEmpty, IsIn, IsOptional } from 'class-validator';

export class CanalSendMediaDto {
  @IsString() @IsNotEmpty() mediaUrl!: string;
  @IsIn(['image', 'audio', 'video', 'document']) mediaType!: 'image' | 'audio' | 'video' | 'document';
  @IsString() @IsNotEmpty() fileName!: string;
  @IsString() @IsOptional() caption?: string;
}
```

- [ ] **Step 2: Escrever o teste que falha (sendMediaMessage)**

Adicionar em `canal-conversation.service.spec.ts`:

```typescript
describe('CanalConversationService.sendMediaMessage', () => {
  it('envia via Meta e grava canal_messages out com media_url', async () => {
    const insert = jest.fn().mockResolvedValue({ error: null });
    const supa = {
      from: jest.fn((table: string) => {
        if (table === 'canal_conversations')
          return {
            select: () => ({ eq: () => ({ single: async () => ({ data: {
              wa_contact_number: '5549999',
              last_in_at: new Date().toISOString(),
              canal_numbers: { phone_number_id: 'PN' },
            } }) }) }),
            update: () => ({ eq: async () => ({}) }),
          };
        if (table === 'canal_messages') return { insert };
        return {};
      }),
    } as unknown as SupabaseClient;
    const meta = { sendMedia: jest.fn().mockResolvedValue({ ok: true, wa_message_id: 'wamid.Z' }) } as unknown as MetaService;
    const svc = new CanalConversationService(supa, meta);

    await svc.sendMediaMessage('c1', 'u1', 'https://pub/x.jpg', 'image', 'x.jpg', 'leg');
    expect(meta.sendMedia).toHaveBeenCalled();
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      direction: 'out', message_type: 'image', media_url: 'https://pub/x.jpg',
    }));
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd apps/api && npx jest src/modules/canal/canal-conversation.service.spec.ts`
Expected: FAIL (`sendMediaMessage` não existe).

- [ ] **Step 4: Implementar `sendMediaMessage`**

Adicionar em `canal-conversation.service.ts` (após `reply`):

```typescript
  /** Funcionário/admin envia mídia pela inbox → Meta + grava 'out'. */
  async sendMediaMessage(
    conversationId: string,
    userId: string,
    mediaUrl: string,
    mediaType: 'image' | 'audio' | 'video' | 'document',
    fileName: string,
    caption?: string,
  ): Promise<void> {
    const { data: conv } = await this.supabase
      .from('canal_conversations')
      .select('wa_contact_number, last_in_at, canal_numbers(phone_number_id)')
      .eq('id', conversationId)
      .single();
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    const cc = conv as unknown as {
      wa_contact_number: string;
      last_in_at: string | null;
      canal_numbers: { phone_number_id: string };
    };
    if (!cc.last_in_at || Date.now() - new Date(cc.last_in_at).getTime() > 24 * 60 * 60 * 1000) {
      throw new BadRequestException('Fora da janela de 24h da Meta — requer template aprovado (indisponível na Fase 1).');
    }
    const result = await this.meta.sendMedia(
      cc.canal_numbers.phone_number_id, cc.wa_contact_number, mediaType, mediaUrl, caption, fileName,
    );
    if (!result.ok) throw new BadRequestException(result.error ?? 'Falha ao enviar mídia pela Meta');
    const now = new Date().toISOString();
    await this.supabase.from('canal_messages').insert({
      conversation_id: conversationId,
      direction: 'out',
      content: caption || fileName,
      message_type: mediaType,
      media_url: mediaUrl,
      wa_message_id: result.wa_message_id ?? null,
      sent_by: userId,
      sent_at: now,
    });
    await this.supabase.from('canal_conversations')
      .update({ last_message_at: now, status: 'human' })
      .eq('id', conversationId);
  }
```

- [ ] **Step 5: Adicionar o endpoint no controller**

Em `canal-inbox.controller.ts`, importar a DTO e adicionar:

```typescript
import { CanalSendMediaDto } from './dto/send-media.dto';
// ...
  @Post(':id/send-media')
  sendMedia(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: CanalSendMediaDto,
  ) {
    return this.convs.sendMediaMessage(id, user.id, dto.mediaUrl, dto.mediaType, dto.fileName, dto.caption);
  }
```

- [ ] **Step 6: Rodar e ver passar**

Run: `cd apps/api && npx jest src/modules/canal/canal-conversation.service.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/canal/dto/send-media.dto.ts apps/api/src/modules/canal/canal-inbox.controller.ts apps/api/src/modules/canal/canal-conversation.service.ts apps/api/src/modules/canal/canal-conversation.service.spec.ts
git commit -m "feat(api): endpoint Canal send-media (Meta por link)"
```

---

### Task 8: Tipo `CanalMessage` + render de mídia e composer no `CanalPanel`

**Files:**
- Modify: `packages/types/src/index.ts:178-186`
- Modify: `apps/web/src/app/(app)/canal/CanalPanel.tsx`

- [ ] **Step 1: Ampliar o tipo `CanalMessage`**

Em `packages/types/src/index.ts`, substituir a interface:

```typescript
export interface CanalMessage {
  id: string;
  conversation_id: string;
  direction: 'in' | 'out';
  content: string;
  message_type: 'text' | 'image' | 'video' | 'audio' | 'document';
  media_url: string | null;
  wa_message_id: string | null;
  sent_by: string | null;
  sent_at: string;
}
```

- [ ] **Step 2: Adicionar estado/refs e o helper de mime no `CanalPanel`**

No topo do arquivo (após `const API = getApiBase();`):

```typescript
function mediaTypeFromMime(mime: string): 'image' | 'video' | 'audio' | 'document' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}
```

Dentro do componente, adicionar estado:

```typescript
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
```

Adicionar a função de upload (após `handleSendText`):

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
      const path = `canal-out/${uid}/${conversationId}/${Date.now()}-${safe}`;
      const up = await supabase.storage.from('wa-media').upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) throw new Error(up.error.message);
      const { data: pub } = supabase.storage.from('wa-media').getPublicUrl(path);
      const res = await fetch(`${API}/api/canal/conversations/${conversationId}/send-media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mediaUrl: pub.publicUrl, mediaType: mediaTypeFromMime(file.type), fileName: file.name, caption: text.trim() || undefined }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(errBody.message ?? 'Erro ao enviar mídia');
      }
      setText('');
      await loadMessages();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao enviar mídia');
    }
    setUploading(false);
  }
```

- [ ] **Step 3: Renderizar mídia nas bolhas**

Substituir o conteúdo da bolha (o `<div>` com `{m.content}`, ~linha 211) por:

```tsx
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
                <a href={m.media_url} target="_blank" rel="noreferrer" style={{ display: 'block', marginBottom: 4, color: 'var(--ammoc-green-700)', fontSize: 13, fontWeight: 600 }}>📎 {m.content || 'documento'}</a>
              )}
              {m.message_type !== 'text' && !m.media_url && (
                <div style={{ fontSize: 12, color: 'var(--ammoc-ink-400)', fontStyle: 'italic', marginBottom: 4 }}>⏳ baixando mídia…</div>
              )}
              {(m.message_type === 'text' || (m.content && m.media_url)) && (
                <div style={{ fontSize: 13, color: 'var(--ammoc-ink-900)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.content}</div>
              )}
```

- [ ] **Step 4: Adicionar o botão de anexo + input no composer**

No composer (antes do `<textarea>`), adicionar:

```tsx
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,audio/*,application/pdf,application/*"
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ''; }}
        />
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} title="Anexar mídia"
          style={{ background: 'var(--ammoc-paper)', border: '1px solid var(--ammoc-line)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', fontSize: 16, cursor: uploading ? 'default' : 'pointer', flexShrink: 0 }}>
          {uploading ? '…' : '📎'}
        </button>
```

- [ ] **Step 5: Build do front + types**

Run: `cd "C:\Users\max_m\OneDrive\Área de Trabalho\GERENCIAMENTO WHATSAPP" && npm run build --workspace @crmwhats/web`
Expected: build OK (sem erros de TypeScript).

- [ ] **Step 6: Commit**

```bash
git add packages/types/src/index.ts "apps/web/src/app/(app)/canal/CanalPanel.tsx"
git commit -m "feat(web): CanalPanel exibe e envia mídia"
```

---

### Task 9: Placeholder "baixando…" no `ConversationPanel` (Evolution)

**Files:**
- Modify: `apps/web/src/app/(app)/meu-numero/ConversationPanel.tsx:159-161`

- [ ] **Step 1: Adicionar o placeholder de mídia pendente**

Antes do bloco de texto (linha ~159), inserir:

```tsx
              {m.message_type !== 'text' && !m.media_url && (
                <div style={{ fontSize: 12, color: 'var(--ammoc-ink-400)', fontStyle: 'italic', marginBottom: 4 }}>⏳ baixando mídia…</div>
              )}
```

E ajustar a condição do texto para não exibir `[mídia]` quando for mídia pendente:

```tsx
              {(m.message_type === 'text' || (m.content && m.media_url)) && (
                <div style={{ fontSize: 13, color: 'var(--ammoc-ink-900)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.content}</div>
              )}
```

- [ ] **Step 2: Build do front**

Run: `cd "C:\Users\max_m\OneDrive\Área de Trabalho\GERENCIAMENTO WHATSAPP" && npm run build --workspace @crmwhats/web`
Expected: build OK.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(app)/meu-numero/ConversationPanel.tsx"
git commit -m "feat(web): placeholder 'baixando mídia' no ConversationPanel"
```

---

### Task 10: Build geral, deploy e verificação ao vivo

**Files:** nenhum (verificação).

- [ ] **Step 1: Rodar toda a suíte de testes da API**

Run: `cd apps/api && npx jest`
Expected: todos verdes.

- [ ] **Step 2: Build de API + web**

Run: `cd "C:\Users\max_m\OneDrive\Área de Trabalho\GERENCIAMENTO WHATSAPP" && npm run build --workspace @crmwhats/api && npm run build --workspace @crmwhats/web`
Expected: ambos OK.

- [ ] **Step 3: Push + deploy (Coolify)**

```bash
git push
```

Disparar deploy da API e do WEB via API do Coolify (token de deploy do handoff):
- API uuid `pp6qewlm9usx4rqroaxzi042`
- WEB uuid `y664pro58rjywtieei0no3ua`

`GET http://2.25.139.166:8000/api/v1/deploy?uuid=<uuid>&force=false` header `Authorization: Bearer 4|eapzDjDej8MwupomynOjKRtnV94SWwZM4ds9EK8s51423d3e`.

- [ ] **Step 4: Verificação ao vivo — recepção Evolution**

Enviar uma **imagem** e um **áudio** do WhatsApp de outro celular para o número pessoal conectado. Em `https://crm.ammoc.org.br/meu-numero`, confirmar que a mídia aparece (não fica só "baixando…"). Conferir logs da API no Coolify se ficar pendente — confirmar o contrato real do `/message/downloadimage` (formato de `data.base64`).

- [ ] **Step 5: Verificação ao vivo — recepção + envio Canal**

Enviar uma imagem para o número oficial **+55 49 9975-3753**; confirmar exibição em `/canal`. Responder anexando uma imagem pela inbox; confirmar entrega no WhatsApp do cidadão e exibição da bolha `out`.

- [ ] **Step 6: Atualizar o handoff**

Atualizar `memory/handoff-estado-projeto.md`: marcar Fase B como concluída e remover da lista de pendências.

---

## Self-Review

- **Cobertura do spec:** recepção Evolution (Tasks 3-4), recepção Canal (Tasks 5-6), envio Canal (Tasks 5,7,8), schema (Task 1), front (Tasks 8-9), storage/erros (helpers Task 2 + background try/catch nas Tasks 4/6), testes (cada task) e verificação ao vivo (Task 10). ✓
- **Sem placeholders:** todos os steps de código têm o código real. ✓
- **Consistência de tipos:** `downloadMedia` (Evolution → `string|null` data-url; Meta → `{mime,buffer}|null`); `sendMedia` (Meta, 6 args) vs `sendMediaMessage` (service, 6 args) — nomes distintos de propósito; `message_type` usa o enum existente em todo lugar; `ingestInbound` recebe `messageType/mediaId/fileName` opcionais, consumidos no controller (Task 6) e testados (Task 6). ✓
