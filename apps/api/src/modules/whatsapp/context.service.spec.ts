import { ContextService } from './context.service';
import { SupabaseClient } from '@supabase/supabase-js';

const makeSupabase = (conv: object, messages: object[]) => {
  const singleConv = jest.fn().mockResolvedValue({ data: conv, error: null });
  const msgOrder   = jest.fn().mockResolvedValue({ data: messages, error: null });
  const upsert     = jest.fn().mockResolvedValue({ error: null });

  const supabase = {
    from: jest.fn().mockImplementation((table: string) => {
      if (table === 'conversations') {
        return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: singleConv }) }) };
      }
      if (table === 'messages') {
        return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ order: msgOrder }) }) };
      }
      if (table === 'context_files') {
        return { upsert };
      }
      return {};
    }),
    _upsert: upsert,
  };
  return supabase as unknown as SupabaseClient & { _upsert: jest.Mock };
};

describe('ContextService', () => {
  it('generateMd creates markdown with header and messages', async () => {
    const conv = {
      id: 'conv-1',
      contact_name: 'João',
      contact_number: '5547999',
      created_at: '2026-01-01T10:00:00Z',
      shared_at: '2026-01-01T11:00:00Z',
      owner_user_id: { name: 'Maria' },
    };
    const messages = [
      { direction: 'in', content: 'Olá!', sent_at: '2026-01-01T10:01:00Z' },
      { direction: 'out', content: 'Oi, como posso ajudar?', sent_at: '2026-01-01T10:02:00Z' },
    ];
    const supa = makeSupabase(conv, messages);
    const service = new ContextService(supa as unknown as SupabaseClient);
    await service.generateMd('conv-1');

    const upsertCall = (supa as unknown as { _upsert: jest.Mock })._upsert.mock.calls[0][0];
    expect(upsertCall.file_type).toBe('md');
    expect(upsertCall.content).toContain('João');
    expect(upsertCall.content).toContain('Olá!');
    expect(upsertCall.content).toContain('Oi, como posso ajudar?');
    expect(upsertCall.message_count).toBe(2);
  });
});
