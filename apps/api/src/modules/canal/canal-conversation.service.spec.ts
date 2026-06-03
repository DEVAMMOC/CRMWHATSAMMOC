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

describe('CanalConversationService.reply auto-assign', () => {
  it('atribui ao remetente quando assigned_to é nulo', async () => {
    const updateArg: Record<string, unknown> = {};
    const supa = {
      from: jest.fn((table: string) => {
        if (table === 'canal_conversations') return {
          select: () => ({ eq: () => ({ single: async () => ({ data: {
            id: 'c1', wa_contact_number: '5549999', last_in_at: new Date().toISOString(),
            assigned_to: null, canal_numbers: { phone_number_id: 'PN' },
          } }) }) }),
          update: (arg: Record<string, unknown>) => { Object.assign(updateArg, arg); return { eq: async () => ({}) }; },
        };
        if (table === 'canal_messages') return { insert: async () => ({ error: null }) };
        return {};
      }),
    } as unknown as SupabaseClient;
    const meta = { sendText: jest.fn().mockResolvedValue({ ok: true, wa_message_id: 'x' }) } as unknown as MetaService;
    const svc = new CanalConversationService(supa, meta);
    await svc.reply('c1', 'user-1', 'oi');
    expect(updateArg.assigned_to).toBe('user-1');
  });

  it('NÃO rouba atribuição existente', async () => {
    const updateArg: Record<string, unknown> = {};
    const supa = {
      from: jest.fn((table: string) => {
        if (table === 'canal_conversations') return {
          select: () => ({ eq: () => ({ single: async () => ({ data: {
            id: 'c1', wa_contact_number: '5549999', last_in_at: new Date().toISOString(),
            assigned_to: 'outro', canal_numbers: { phone_number_id: 'PN' },
          } }) }) }),
          update: (arg: Record<string, unknown>) => { Object.assign(updateArg, arg); return { eq: async () => ({}) }; },
        };
        if (table === 'canal_messages') return { insert: async () => ({ error: null }) };
        return {};
      }),
    } as unknown as SupabaseClient;
    const meta = { sendText: jest.fn().mockResolvedValue({ ok: true, wa_message_id: 'x' }) } as unknown as MetaService;
    const svc = new CanalConversationService(supa, meta);
    await svc.reply('c1', 'user-1', 'oi');
    expect(updateArg.assigned_to).toBeUndefined();
  });
});

describe('CanalConversationService.delegate/assume/setMeta', () => {
  const baseSupa = () => {
    const calls: Record<string, unknown> = {};
    const supa = {
      from: jest.fn((t: string) => {
        if (t === 'canal_conversations') return {
          select: () => ({ eq: () => ({ single: async () => ({ data: { assigned_to: null, wa_contact_number: '5549', last_in_at: new Date().toISOString(), canal_numbers: { phone_number_id: 'PN' } }, error: null }) }) }),
          update: (arg: Record<string, unknown>) => { calls['upd'] = arg; return { eq: async () => ({ error: null }) }; },
        };
        if (t === 'canal_messages') return { insert: (arg: Record<string, unknown>) => { calls['sysmsg'] = arg; return Promise.resolve({ error: null }); } };
        if (t === 'users') return { select: () => ({ eq: () => ({ single: async () => ({ data: { name: 'Felipe' } }) }) }) };
        if (t === 'sectors') return { select: () => ({ eq: () => ({ single: async () => ({ data: { name: 'Tributos' } }) }) }) };
        if (t === 'notifications') return { insert: async () => ({ error: null }) };
        return {};
      }),
    };
    return { supa, calls };
  };

  it('delegate seta status open e gera evento de setor', async () => {
    const { supa, calls } = baseSupa();
    const meta = { sendText: jest.fn().mockResolvedValue({ ok: true }) } as unknown as MetaService;
    await new CanalConversationService(supa as never, meta).delegate('c1', 'sec1', null);
    expect((calls['upd'] as { status: string }).status).toBe('open');
    expect((calls['sysmsg'] as { is_system: boolean; content: string }).is_system).toBe(true);
    expect((calls['sysmsg'] as { content: string }).content).toContain('Tributos');
  });

  it('assume seta human + assumed_by e evento', async () => {
    const { supa, calls } = baseSupa();
    const meta = { sendText: jest.fn().mockResolvedValue({ ok: true }) } as unknown as MetaService;
    await new CanalConversationService(supa as never, meta).assume('c1', 'u1');
    const upd = calls['upd'] as { status: string; assumed_by: string };
    expect(upd.status).toBe('human');
    expect(upd.assumed_by).toBe('u1');
    expect((calls['sysmsg'] as { content: string }).content).toContain('assumiu');
  });

  it('setMeta grava subject/municipality', async () => {
    const { supa, calls } = baseSupa();
    await new CanalConversationService(supa as never, {} as unknown as MetaService).setMeta('c1', { subject: 'IPTU', municipality: 'Joaçaba' });
    const upd = calls['upd'] as { subject: string; municipality: string };
    expect(upd.subject).toBe('IPTU');
    expect(upd.municipality).toBe('Joaçaba');
  });

  it('notifyCitizen NÃO envia fora da janela 24h', async () => {
    const calls: Record<string, unknown> = {};
    const supa = { from: jest.fn((t: string) => {
      if (t === 'canal_conversations') return {
        select: () => ({ eq: () => ({ single: async () => ({ data: { assigned_to: null, wa_contact_number: '5549', last_in_at: new Date(0).toISOString(), canal_numbers: { phone_number_id: 'PN' } }, error: null }) }) }),
        update: () => ({ eq: async () => ({ error: null }) }),
      };
      if (t === 'canal_messages') return { insert: async () => ({ error: null }) };
      if (t === 'sectors') return { select: () => ({ eq: () => ({ single: async () => ({ data: { name: 'X' } }) }) }) };
      return {};
    }) };
    const sendText = jest.fn().mockResolvedValue({ ok: true });
    await new CanalConversationService(supa as never, { sendText } as unknown as MetaService).delegate('c1', 'sec1', null);
    expect(sendText).not.toHaveBeenCalled();
  });
});
