import { WhatsAppService } from './whatsapp.service';
import { EvolutionService } from './evolution.service';
import { SupabaseClient } from '@supabase/supabase-js';

const makeSupabase = () => {
  const single = jest.fn().mockResolvedValue({ data: null, error: null });
  const update = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });
  const select = jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single }) });
  const from   = jest.fn().mockReturnValue({ select, update });
  return { from } as unknown as SupabaseClient;
};

const makeEvolution = () => ({
  createOrFindInstance: jest.fn().mockResolvedValue({ id: 'inst-1', name: 'user-abc', token: 'tok-1' }),
  connectInstance:      jest.fn().mockResolvedValue(undefined),
  getQR:                jest.fn().mockResolvedValue({ base64: 'data:image/png;base64,QR' }),
  pairInstance:         jest.fn().mockResolvedValue({ code: '12345678' }),
  getStatus:            jest.fn().mockResolvedValue({ status: 'open' }),
  deleteInstance:       jest.fn().mockResolvedValue(undefined),
} as unknown as EvolutionService);

describe('WhatsAppService', () => {
  let service: WhatsAppService;
  let evo: ReturnType<typeof makeEvolution>;
  let supa: SupabaseClient;

  beforeEach(() => {
    evo  = makeEvolution();
    supa = makeSupabase();
    service = new WhatsAppService(evo, supa, 'http://api.test');
  });

  it('connect: calls createOrFindInstance and connectInstance', async () => {
    (supa.from as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: { evolution_instance_token: null, evolution_instance_id: null, whatsapp_status: 'disconnected' },
            error: null,
          }),
        }),
      }),
      update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
    });
    await service.connect('user-1');
    expect(evo.createOrFindInstance).toHaveBeenCalled();
    expect(evo.connectInstance).toHaveBeenCalledWith('tok-1', expect.stringContaining('tok-1'));
  });

  it('getQR: fetches QR from EvolutionService using stored token', async () => {
    (supa.from as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: { evolution_instance_token: 'tok-1', evolution_instance_id: 'inst-1', whatsapp_status: 'connecting' },
            error: null,
          }),
        }),
      }),
    });
    const result = await service.getQR('user-1');
    expect(evo.getQR).toHaveBeenCalledWith('tok-1');
    expect(result.base64).toBe('data:image/png;base64,QR');
  });
});
