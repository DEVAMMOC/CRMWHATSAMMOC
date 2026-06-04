import { Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

interface SyncConfig {
  repo: string;
  branch: string;
  output_dir: string | null;
  pat_token: string;
  generate_index: boolean;
}

/**
 * Envia os `context_files` pendentes para o repositório do Segundo Cérebro via
 * GitHub Contents API (sem binário git). Usa a config em `github_sync_config`.
 */
@Injectable()
export class GithubSyncService {
  private readonly logger = new Logger(GithubSyncService.name);
  constructor(private readonly supabase: SupabaseClient) {}

  private async config(): Promise<SyncConfig | null> {
    const { data } = await this.supabase
      .from('github_sync_config')
      .select('repo, branch, output_dir, pat_token, generate_index')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    return (data as SyncConfig | null) ?? null;
  }

  /** Envia ao GitHub todos os arquivos pendentes. Retorna a contagem. */
  async syncPending(): Promise<{ synced: number; failed: number }> {
    const cfg = await this.config();
    if (!cfg?.pat_token || !cfg.repo) {
      this.logger.warn('github sync: configuração ausente/inativa');
      return { synced: 0, failed: 0 };
    }
    const { data: pend } = await this.supabase
      .from('context_files')
      .select('id, github_path, content')
      .eq('status', 'pending')
      .limit(100);
    const files = (pend ?? []) as Array<{ id: string; github_path: string; content: string }>;

    let synced = 0;
    let failed = 0;
    for (const f of files) {
      try {
        const sha = await this.putFile(cfg, f.github_path, f.content);
        await this.supabase
          .from('context_files')
          .update({ status: 'success', github_commit_sha: sha, error_message: null })
          .eq('id', f.id);
        synced++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await this.supabase
          .from('context_files')
          .update({ status: 'error', error_message: msg.slice(0, 500) })
          .eq('id', f.id);
        this.logger.warn(`github sync falhou ${f.github_path}: ${msg}`);
        failed++;
      }
    }

    if (synced > 0 && cfg.generate_index) {
      await this.rebuildIndex(cfg).catch((e) =>
        this.logger.warn(`índice falhou: ${e instanceof Error ? e.message : String(e)}`),
      );
    }
    await this.supabase
      .from('github_sync_config')
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: failed > 0 ? 'error' : 'success',
      })
      .eq('repo', cfg.repo);

    if (synced || failed) this.logger.log(`github sync: ${synced} enviados, ${failed} falhas`);
    return { synced, failed };
  }

  /** PUT de um arquivo (cria ou atualiza). Retorna o sha do blob. */
  private async putFile(cfg: SyncConfig, path: string, content: string): Promise<string> {
    const url = `https://api.github.com/repos/${cfg.repo}/contents/${encodeURI(path)}`;
    const headers = {
      Authorization: `token ${cfg.pat_token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'crmwhats-ammoc',
    };
    // sha do arquivo existente (se houver) — necessário p/ update.
    let sha: string | undefined;
    const getRes = await fetch(`${url}?ref=${cfg.branch}`, { headers });
    if (getRes.ok) {
      const b = (await getRes.json().catch(() => ({}))) as { sha?: string };
      sha = b.sha;
    }
    const body: Record<string, unknown> = {
      message: `chore: export ${path}`,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch: cfg.branch,
    };
    if (sha) body.sha = sha;
    const putRes = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
    if (!putRes.ok) {
      throw new Error(`GitHub ${putRes.status}: ${(await putRes.text()).slice(0, 200)}`);
    }
    const pb = (await putRes.json().catch(() => ({}))) as { content?: { sha?: string } };
    return pb.content?.sha ?? '';
  }

  /** Reconstrói o INDICE.json a partir dos .json já sincronizados. */
  private async rebuildIndex(cfg: SyncConfig): Promise<void> {
    const { data } = await this.supabase
      .from('context_files')
      .select('content, github_path')
      .eq('file_type', 'json')
      .eq('status', 'success')
      .limit(1000);
    const items = ((data ?? []) as Array<{ content: string; github_path: string }>)
      .map((r) => {
        try {
          const j = JSON.parse(r.content) as Record<string, unknown>;
          return {
            id: j.id,
            data: j.data,
            municipio: j.municipio,
            assunto: j.assunto,
            status: j.status,
            path: r.github_path,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    await this.putFile(cfg, 'conversas/INDICE.json', JSON.stringify(items, null, 2));
  }
}
