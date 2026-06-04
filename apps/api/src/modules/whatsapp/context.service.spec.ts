import { ContextService } from './context.service';
import { SupabaseClient } from '@supabase/supabase-js';

describe('ContextService.generateMd (export unificado)', () => {
  it('gera md+json pending em /conversas com contexto/resolução', async () => {
    const conv = {
      id: 'aaaaaaaa-0000-0000-0000-000000000000',
      contact_name: 'João',
      contact_number: '5547999',
      status: 'encerrada',
      municipality: 'Luzerna',
      subject: 'Iluminação pública',
      created_at: '2026-01-01T10:00:00Z',
      shared_at: '2026-01-01T11:00:00Z',
      last_message_at: '2026-01-01T12:00:00Z',
      owner: { name: 'Maria', role: 'funcionario' },
      assigned: null,
      sectors: { name: 'Obras' },
    };
    const messages = [
      { direction: 'in', content: 'Poste queimado na rua X', sent_at: '2026-01-01T10:01:00Z' },
      { direction: 'out', content: 'Equipe a caminho', sent_at: '2026-01-01T10:02:00Z' },
    ];
    let inserted: Array<Record<string, unknown>> = [];
    const supa = {
      from: jest.fn((table: string) => {
        if (table === 'conversations')
          return { select: () => ({ eq: () => ({ single: async () => ({ data: conv, error: null }) }) }) };
        if (table === 'messages')
          return {
            select: () => ({
              eq: () => ({
                gte: () => ({ order: async () => ({ data: messages, error: null }) }),
                order: async () => ({ data: messages, error: null }),
              }),
            }),
          };
        if (table === 'context_files')
          return {
            delete: () => ({ eq: async () => ({}) }),
            insert: async (rows: Array<Record<string, unknown>>) => {
              inserted = rows;
              return { error: null };
            },
          };
        return {};
      }),
    } as unknown as SupabaseClient;

    const ai = { summarize: jest.fn().mockResolvedValue(null) } as never;
    await new ContextService(supa, ai).generateMd('aaaaaaaa-0000-0000-0000-000000000000');

    expect(inserted).toHaveLength(2);
    const md = inserted.find((r) => r.file_type === 'md') as Record<string, string>;
    const json = inserted.find((r) => r.file_type === 'json') as Record<string, string>;
    expect(md.status).toBe('pending');
    expect(md.github_path).toContain('conversas/luzerna/2026/');
    expect(md.content).toContain('João');
    expect(md.content).toContain('## Resolução');
    const parsed = JSON.parse(json.content) as Record<string, unknown>;
    expect(parsed.canal).toBe('numero-pessoal');
    expect(parsed.municipio).toBe('Luzerna');
    expect(parsed.assunto).toBe('Iluminação pública');
    expect((parsed.participantes as Array<{ nome: string }>)[0].nome).toBe('Maria');
  });
});
