import { CanalConversationService } from './canal-conversation.service';
import { SupabaseClient } from '@supabase/supabase-js';
import { MetaService } from './meta.service';

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
