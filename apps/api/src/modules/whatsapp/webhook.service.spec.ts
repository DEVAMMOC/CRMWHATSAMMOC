import { WebhookService } from './webhook.service';
import { SupabaseClient } from '@supabase/supabase-js';
import { EvolutionService } from './evolution.service';

const makeEvolution = () => ({
  downloadMedia: jest.fn().mockResolvedValue('data:image/jpeg;base64,aGk='),
  getStatus: jest.fn().mockResolvedValue({ status: 'connected' }),
} as unknown as EvolutionService);

const makeSupabase = () => {
  const upsert  = jest.fn().mockResolvedValue({ error: null });
  const insert  = jest.fn().mockResolvedValue({ data: [{ id: 'conv-1' }], error: null });
  const selectSingle = jest.fn().mockResolvedValue({ data: null, error: null });
  const update  = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });
  const selectEq    = jest.fn().mockReturnValue({ single: selectSingle });
  const selectFrom  = jest.fn().mockReturnValue({ eq: selectEq });
  return {
    from: jest.fn().mockReturnValue({
      select: selectFrom,
      insert,
      upsert,
      update,
    }),
  } as unknown as SupabaseClient;
};

describe('WebhookService', () => {
  let service: WebhookService;
  let supa: SupabaseClient;

  beforeEach(() => {
    supa    = makeSupabase();
    service = new WebhookService(supa, makeEvolution());
  });

  it('handleEvent ignores unknown event types without throwing', async () => {
    await expect(service.handleEvent('tok-1', { event: 'unknown.event', data: {} }))
      .resolves.not.toThrow();
  });

  it('handleConnectionUpdate updates user whatsapp_status', async () => {
    (supa.from as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: { id: 'user-1' }, error: null }),
        }),
      }),
      update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
    });
    await service.handleEvent('tok-1', { event: 'connection.update', data: { state: 'open' } });
    // Verify update was called — from('users') should have been called
    expect(supa.from).toHaveBeenCalledWith('users');
  });

  it('connection.update open SEM login não marca connected (usa getStatus → connecting)', async () => {
    const update = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });
    (supa.from as jest.Mock).mockReturnValue({
      select: () => ({ eq: () => ({ single: jest.fn().mockResolvedValue({ data: { id: 'user-1' }, error: null }) }) }),
      update,
    });
    const evo = { getStatus: jest.fn().mockResolvedValue({ status: 'connecting' }) } as unknown as EvolutionService;
    service = new WebhookService(supa, evo);
    await service.handleEvent('tok-1', { event: 'connection.update', data: { state: 'open' } });
    expect((evo.getStatus as jest.Mock)).toHaveBeenCalledWith('tok-1');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ whatsapp_status: 'connecting' }));
  });

  it('connection.update close marca disconnected sem chamar getStatus', async () => {
    const update = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });
    (supa.from as jest.Mock).mockReturnValue({
      select: () => ({ eq: () => ({ single: jest.fn().mockResolvedValue({ data: { id: 'user-1' }, error: null }) }) }),
      update,
    });
    const evo = { getStatus: jest.fn() } as unknown as EvolutionService;
    service = new WebhookService(supa, evo);
    await service.handleEvent('tok-1', { event: 'connection.update', data: { state: 'close' } });
    expect((evo.getStatus as jest.Mock)).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ whatsapp_status: 'disconnected' }));
  });

  it('grava mensagem de imagem recebida com message_type image', async () => {
    const single = jest.fn().mockResolvedValueOnce({ data: { id: 'user-1' }, error: null }); // users lookup
    const upsertConv = jest.fn().mockReturnValue({
      select: () => ({ single: jest.fn().mockResolvedValue({ data: { id: 'conv-1' }, error: null }) }),
    });
    const upsertMsg = jest.fn().mockResolvedValue({ error: null });
    const update = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });
    (supa.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'users') return { select: () => ({ eq: () => ({ single }) }) };
      if (table === 'conversations') return { upsert: upsertConv };
      if (table === 'messages') return { upsert: upsertMsg, update };
      return {};
    });

    await service.handleEvent('tok-1', {
      event: 'Message',
      data: {
        Info: { Chat: '5547999@s.whatsapp.net', ID: 'M1', IsFromMe: false, PushName: 'Fulano' },
        Message: { imageMessage: { caption: 'oi', url: 'x', mediaKey: 'k' } },
      },
    });

    expect(upsertMsg).toHaveBeenCalledWith(
      expect.objectContaining({ message_type: 'image', content: 'oi' }),
      expect.anything(),
    );
  });
});
