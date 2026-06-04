# Fase 4 — Exportação de conversas para o Segundo Cérebro (Git) — Design

**Data:** 2026-06-03 · **Status:** aguardando aprovação final
**Repo destino:** `DEVAMMOC/SECOND_BRAIN_AMMOC`, pasta `/conversas`.

## Objetivo
O CRMWhats compacta cada atendimento (do **Canal**) num resumo `.md` + `.json` mostrando
contexto, resolução, participantes, data, município e assunto, e faz **push** para o
repositório Git do Segundo Cérebro, organizado por **município → ano**.

## Parte A — Estrutura no repo (contrato)
```
/conversas/
├── README.md            ← spec do formato (fonte da verdade)
├── MAPA.md
├── INDICE.json          ← índice append (id, municipio, data, assunto, status, path)
├── _template/
│   ├── conversa.template.md
│   └── conversa.schema.json
└── {municipio-slug}/{AAAA}/{data}_{assunto-slug}_{idcurto}.md (+ .json)
```
`.md` (front-matter + Contexto / Andamento / Resolução) e `.json` (schema com
id, data, municipio, assunto, setor, status, canal, contato, participantes[], contexto,
resolucao, eventos[], tags[], mensagens_total, exportado_em).

## Parte B — Banco (migração)
- `context_files`: add `canal_conversation_id uuid references canal_conversations(id) on delete cascade`
  nullable; tornar `conversation_id` nullable; trocar a unique `(conversation_id,file_type)` por
  índices únicos parciais p/ cada origem. (Permite guardar exportações do Canal.)
- `github_sync_config`: inserir 1 linha — `repo='DEVAMMOC/SECOND_BRAIN_AMMOC'`, `branch` (main/master),
  `output_dir='conversas'`, `pat_token=<PAT com acesso de escrita ao repo>`, `only_closed=true`,
  `generate_md=true`, `generate_json=true`, `generate_index=true`, `is_active=true`.

## Parte C — Builder do resumo (`CanalExportService`)
`buildExport(canalConversationId)`:
- Lê `canal_conversations` (+ sector name) e `canal_messages` (inclui `is_system`).
- Metadados: data (closed_at|created_at), município (`municipality`), assunto (`subject`),
  setor, status, canal, contato (`wa_contact_name`/número).
- Participantes: `assumed_by` + autores (`sent_by`) das mensagens + nomes nas pílulas de evento.
- **Contexto** (determinístico): primeiras mensagens `in` do cidadão (sem depender de LLM).
- **Andamento:** lista das pílulas `is_system` (delegado/assumiu/transferido).
- **Resolução** (determinístico): `close_reason`/quem encerrou + última mensagem `out`.
- *(Opcional futuro:* se `agent_config.api_key` + `auto_summarize`, gerar contexto/resolução
  mais ricos via LLM. Nesta fase: determinístico.)*
- Gera `.md` (template) e `.json` (schema); grava em `context_files` (file_type md/json,
  `github_path='conversas/{municipio}/{ano}/{arquivo}'`, status `pending`).

## Parte D — Push para o GitHub (`GithubSyncService`)
- Lê `github_sync_config` (ativa). Para cada `context_files` `pending`:
  - GitHub **Contents API** `PUT /repos/{repo}/contents/{output_dir}/{github_path}` com
    `content` em base64, `branch`, e `sha` do arquivo existente (GET antes) p/ update.
  - Atualiza `context_files.github_commit_sha` + status `synced` (ou `error` + `error_message`).
- Atualiza `INDICE.json` (lê, faz append do novo item, re-PUT).
- Sem binário git no servidor — tudo via API REST com o `pat_token`.

## Parte E — Gatilho
- Ao **encerrar** uma conversa do Canal (`setStatus`/`close` → `closed`): dispara
  `buildExport(...)` + push (fire-and-forget, log em erro). Respeita `only_closed`.
- **Cron** (`@nestjs/schedule`, no `sync_time`): reprocessa `context_files` `pending`/`error`
  (resiliência se um push falhar). Reusa o `canal-scheduler` existente.

## Pré-requisitos (do usuário)
1. **PAT com escrita** no `DEVAMMOC/SECOND_BRAIN_AMMOC` (o PAT do CRMWHATSAMMOC pode não ter escopo nesse repo — confirmar/fornecer).
2. Branch padrão do repo (main ou master).

## Segurança
- `pat_token` fica em `github_sync_config` (Supabase, service-role) — nunca no front nem em logs.
- Os `.md`/`.json` de conversa contêm dados de cidadãos (nome/número/assunto) → o repo deve ser **privado**.

## Testes
- Unit: `buildExport` monta md/json com os campos certos (mock supabase); `GithubSyncService` faz PUT com base64 + sha (mock fetch); índice append.
- Migração verificada via SQL. Push real verificado contra o repo após config.

## Escopo
- **Canal** (`canal_conversations`) nesta fase (é o canal oficial e tem município/assunto/setor).
  Conversas do número pessoal podem ser adicionadas depois com o mesmo pipeline.
