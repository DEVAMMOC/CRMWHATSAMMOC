# Fase 4 — Export de conversas p/ Segundo Cérebro — Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Ao encerrar uma conversa do Canal, gerar resumo `.md`+`.json` (contexto/resolução/participantes/data/município/assunto) e dar push para `DEVAMMOC/SECOND_BRAIN_AMMOC` em `/conversas/{municipio}/{ano}/`.

**Stack:** NestJS, Supabase (service-role), GitHub Contents API, @nestjs/schedule.

## Tasks
1. **Migração** (MCP, controlador): `context_files` += `canal_conversation_id` (FK canal, on delete cascade), `conversation_id` nullable; partial unique idx por origem+file_type; inserir linha `github_sync_config` (repo `DEVAMMOC/SECOND_BRAIN_AMMOC`, branch `main`, output_dir `conversas`, pat_token, only_closed=true, generate_md/json/index=true, is_active=true).
2. **Estrutura do repo** (controlador): clonar SECOND_BRAIN_AMMOC e criar `/conversas/{README,MAPA,INDICE.json,_template/conversa.template.md,_template/conversa.schema.json}` + push.
3. **slug util + CanalExportService.buildAndStore(id)** (subagent, TDD): monta md+json determinístico, delete+insert em `context_files` (pending), github_path `conversas/{municipio}/{ano}/{data}_{assunto}_{idcurto}.{ext}`.
4. **GithubSyncService.syncPending()** (subagent, TDD): lê config + context_files pending; PUT Contents API (base64 + sha se existir); atualiza INDICE.json; marca synced/error.
5. **Wiring + gatilho** (subagent): providers no canal.module; `close`/`setStatus(closed)` dispara buildAndStore+syncPending (fire-and-forget); cron reprocessa pendentes.
6. **Build, deploy, verificar** (controlador): suíte, build, deploy API, encerrar uma conversa de teste e conferir o arquivo no repo.

Detalhes de código nos prompts dos subagentes (controlador fornece).
