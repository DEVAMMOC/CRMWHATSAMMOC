import { GithubSyncService } from './github-sync.service';
import { SupabaseClient } from '@supabase/supabase-js';

describe('GithubSyncService.syncPending', () => {
  afterEach(() => jest.restoreAllMocks());

  it('faz PUT dos pendentes e marca success com o sha', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const supa = {
      from: jest.fn((t: string) => {
        if (t === 'github_sync_config')
          return {
            select: () => ({
              eq: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: { repo: 'O/R', branch: 'main', output_dir: 'conversas', pat_token: 'tok', generate_index: false },
                  }),
                }),
              }),
            }),
            update: () => ({ eq: async () => ({}) }),
          };
        if (t === 'context_files')
          return {
            select: () => ({ eq: () => ({ limit: async () => ({ data: [{ id: 'f1', github_path: 'conversas/x.md', content: 'oi' }] }) }) }),
            update: (arg: Record<string, unknown>) => {
              updates.push(arg);
              return { eq: async () => ({}) };
            },
          };
        return {};
      }),
    } as unknown as SupabaseClient;

    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}), text: async () => '' } as Response) // GET sha → não existe
      .mockResolvedValueOnce({ ok: true, json: async () => ({ content: { sha: 'newsha' } }) } as Response); // PUT

    const r = await new GithubSyncService(supa).syncPending();
    expect(r.synced).toBe(1);
    expect(r.failed).toBe(0);
    expect(updates.some((u) => u.status === 'success' && u.github_commit_sha === 'newsha')).toBe(true);
  });

  it('marca error quando o PUT falha', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const supa = {
      from: jest.fn((t: string) => {
        if (t === 'github_sync_config')
          return {
            select: () => ({ eq: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { repo: 'O/R', branch: 'main', output_dir: 'conversas', pat_token: 'tok', generate_index: false } }) }) }) }),
            update: () => ({ eq: async () => ({}) }),
          };
        if (t === 'context_files')
          return {
            select: () => ({ eq: () => ({ limit: async () => ({ data: [{ id: 'f1', github_path: 'conversas/x.md', content: 'oi' }] }) }) }),
            update: (arg: Record<string, unknown>) => {
              updates.push(arg);
              return { eq: async () => ({}) };
            },
          };
        return {};
      }),
    } as unknown as SupabaseClient;

    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}), text: async () => '' } as Response)
      .mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({}), text: async () => 'bad' } as Response);

    const r = await new GithubSyncService(supa).syncPending();
    expect(r.failed).toBe(1);
    expect(updates.some((u) => u.status === 'error')).toBe(true);
  });
});
