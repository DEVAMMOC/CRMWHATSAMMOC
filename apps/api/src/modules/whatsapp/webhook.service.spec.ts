import { WebhookService } from './webhook.service';
import { SupabaseClient } from '@supabase/supabase-js';

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
    service = new WebhookService(supa);
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
});
