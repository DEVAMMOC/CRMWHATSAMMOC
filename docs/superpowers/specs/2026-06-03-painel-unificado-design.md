# Meu Painel unificado (pessoal + Canal) — Design

**Data:** 2026-06-03 · **Status:** aprovado (opção 1 — unificar telas no front)

## Problema (causa raiz confirmada)
As telas do "Meu Painel" leem só o sistema do número pessoal (`conversations`/`attendances`).
As conversas do **Canal** (`canal_conversations`) vivem num silo (`/canal`, `/kanban`). Por isso
uma conversa **delegada no Canal** gera notificação e aparece no `/canal`, mas **não** em
Recebidos/Atendimentos/Conversas. (Evidência: `notifications.link='/canal'`, type `delegation`.)

## Solução (opção 1 — sem mudar o banco; padrão do `/contatos`)
Cada tela passa a ler TAMBÉM `canal_conversations` (RLS já escopa por `assigned_to`/`leads_sector`/admin)
e mesclar com as conversas pessoais, marcando o **canal** de cada item.

Forma normalizada do item de lista:
`{ key, channel: 'pessoal'|'canal', id, name, number, status, sector_id, municipality, subject, last_message_at }`
- pessoal: `name=contact_name`, `number=contact_number`.
- canal: `name=wa_contact_name`, `number=wa_contact_number`.

### Recebidos (`/recebidos`)
- Pessoal: `conversations` `status='pendente'` (atual).
- Canal: `canal_conversations` `status='open'` **e** `assigned_to = meu id` (delegadas a mim, aguardando).
- "Assumir" num item do Canal → `POST /api/canal/conversations/:id/assume`; pessoal mantém o fluxo atual.
- Item do Canal navega para `/canal`.

### Atendimentos (`/atendimentos`)
- Pessoal: `attendances` (atual).
- Canal: `canal_conversations` `status='human'` **e** `assigned_to = meu id` (meu atendimento ativo), exibidas como linhas de atendimento marcadas "Canal".
- "Encerrar" do Canal → `POST /api/canal/conversations/:id/close`. Abrir → `/canal`.

### Conversas (`/dashboard`)
- Pessoal: `conversations` `status != 'nao_salva'` (atual).
- Canal: `canal_conversations` visíveis (RLS), mescladas e marcadas com o canal → histórico de tudo.
- Item do Canal navega para `/canal`; pessoal para `/conversa/:id` (atual).

## Helper
`apps/web/src/lib/canal-list.ts`: função client que busca `canal_conversations` (via supabase client,
RLS) com os campos necessários e devolve já normalizado, p/ DRY entre as 3 páginas.

## Não-objetivos
- Não cria linhas em `attendances` para o Canal (sem migração). As conversas do Canal aparecem nas
  telas como atendimento/recebido/histórico, mas o "registro formal" continua no `canal_conversations`.
- Não mexe em `/canal` nem `/kanban` (já funcionam).

## Testes
- `next build` (typecheck/lint) nas 3 páginas + helper.
- Verificação ao vivo: delegar uma conversa do Canal a um funcionário → conferir que aparece em
  Recebidos (Aguardando), Assumir → vai p/ Atendimentos, e consta em Conversas.
