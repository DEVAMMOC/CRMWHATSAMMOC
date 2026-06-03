import { MetaService } from './meta.service';
import { SupabaseClient } from '@supabase/supabase-js';

const supaWithToken = () =>
  ({
    from: () => ({
      select: () => ({
        limit: () => ({
          single: async () => ({
            data: { access_token: 'TK', app_secret: '', verify_token: 'v' },
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient);

describe('MetaService media', () => {
  let svc: MetaService;
  beforeEach(() => {
    svc = new MetaService(supaWithToken());
  });
  afterEach(() => jest.restoreAllMocks());

  it('downloadMedia faz GET do id, depois GET da url e devolve mime+buffer', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: 'https://lookaside/x', mime_type: 'image/png' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      } as Response);
    const out = await svc.downloadMedia('MID');
    expect(out).not.toBeNull();
    expect(out!.mime).toBe('image/png');
    expect(Buffer.isBuffer(out!.buffer)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sendMedia envia type image com link/caption', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.X' }] }),
    } as Response);
    const r = await svc.sendMedia(
      'PN1',
      '5549999',
      'image',
      'https://pub/x.jpg',
      'leg',
      undefined,
    );
    expect(r.ok).toBe(true);
    expect(r.wa_message_id).toBe('wamid.X');
    const sentBody = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(sentBody.type).toBe('image');
    expect(sentBody.image.link).toBe('https://pub/x.jpg');
    expect(sentBody.image.caption).toBe('leg');
  });
});
