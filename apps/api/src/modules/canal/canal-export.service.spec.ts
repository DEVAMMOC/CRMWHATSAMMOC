import { CanalExportService } from './canal-export.service';
import { slugify } from '../../common/conversation-export';
import { SupabaseClient } from '@supabase/supabase-js';

describe('slugify', () => {
  it('normaliza acento/espaço/símbolo', () => {
    expect(slugify('Joaçaba')).toBe('joacaba');
    expect(slugify("Herval D'Oeste")).toBe('herval-d-oeste');
    expect(slugify('Revisão de IPTU')).toBe('revisao-de-iptu');
    expect(slugify('')).toBe('sem');
  });
});

describe('CanalExportService.buildAndStore', () => {
  it('gera md+json pending com path por municipio/ano e campos certos', async () => {
    let inserted: Array<Record<string, unknown>> = [];
    const supa = {
      from: jest.fn((t: string) => {
        if (t === 'canal_conversations')
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: 'abcdef12-0000-0000-0000-000000000000',
                    wa_contact_number: '5549',
                    wa_contact_name: 'André',
                    status: 'closed',
                    subject: 'Revisão de IPTU',
                    municipality: 'Joaçaba',
                    assigned_to: 'u1',
                    assumed_by: 'u1',
                    closed_at: '2026-06-03T20:00:00Z',
                    close_reason: 'manual',
                    last_message_at: '2026-06-03T19:00:00Z',
                    created_at: '2026-06-03T17:00:00Z',
                    sectors: { name: 'Tributos' },
                    canal_numbers: { label: 'AMMOC' },
                  },
                }),
              }),
            }),
          };
        if (t === 'canal_messages')
          return {
            select: () => ({
              eq: () => ({
                order: async () => ({
                  data: [
                    { direction: 'in', content: 'Quero revisar meu IPTU', sent_at: '2026-06-03T17:00:00Z', is_system: false, sent_by: null },
                    { direction: 'out', content: '🔀 Delegado ao setor Tributos', sent_at: '2026-06-03T17:05:00Z', is_system: true, sent_by: null },
                    { direction: 'out', content: 'Resolvido, abraço', sent_at: '2026-06-03T19:00:00Z', is_system: false, sent_by: 'u1' },
                  ],
                }),
              }),
            }),
          };
        if (t === 'users')
          return { select: () => ({ in: async () => ({ data: [{ id: 'u1', name: 'Felipe', role: 'funcionario' }] }) }) };
        if (t === 'context_files')
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

    await new CanalExportService(supa).buildAndStore('abcdef12-0000-0000-0000-000000000000');

    expect(inserted).toHaveLength(2);
    const md = inserted.find((r) => r.file_type === 'md') as Record<string, string>;
    const json = inserted.find((r) => r.file_type === 'json') as Record<string, string>;
    expect(md.status).toBe('pending');
    expect(md.github_path).toContain('conversas/joacaba/2026/');
    expect(md.github_path).toContain('revisao-de-iptu');
    expect(md.content).toContain('## Resolução');
    expect(md.content).toContain('Delegado ao setor Tributos');
    const parsed = JSON.parse(json.content) as Record<string, unknown>;
    expect(parsed.municipio).toBe('Joaçaba');
    expect(parsed.assunto).toBe('Revisão de IPTU');
    expect(parsed.status).toBe('encerrada');
    expect((parsed.participantes as Array<{ nome: string }>)[0].nome).toBe('Felipe');
    expect(parsed.contexto).toContain('IPTU');
  });
});
