import { EvolutionService } from './evolution.service';
import { ConfigService } from '@nestjs/config';

const mockConfig = {
  getOrThrow: (key: string) => {
    if (key === 'evolution.url') return 'http://evo:8085';
    if (key === 'evolution.apiKey') return 'test-key';
    throw new Error(`Unknown key: ${key}`);
  },
} as unknown as ConfigService;

describe('EvolutionService', () => {
  let service: EvolutionService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new EvolutionService(mockConfig);
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'inst-1', name: 'user-abc' }),
      text: () => Promise.resolve(''),
    } as unknown as Response);
  });

  afterEach(() => { fetchSpy.mockRestore(); });

  it('createInstance posts to /instance/create with apikey header', async () => {
    const result = await service.createInstance('user-abc', 'token-123');
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://evo:8085/instance/create',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ apikey: 'test-key' }),
        body: JSON.stringify({ name: 'user-abc', token: 'token-123' }),
      }),
    );
    expect(result).toEqual({ id: 'inst-1', name: 'user-abc' });
  });

  it('getQR sends token header', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ base64: 'data:image/png;base64,abc' }),
    } as unknown as Response);
    const result = await service.getQR('tok-1');
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://evo:8085/instance/qr',
      expect.objectContaining({
        headers: expect.objectContaining({ token: 'tok-1' }),
      }),
    );
    expect(result.base64).toBe('data:image/png;base64,abc');
  });

  it('throws when response is not ok', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve('unauthorized'),
    } as unknown as Response);
    await expect(service.createInstance('n', 't')).rejects.toThrow('Evolution create failed');
  });
});
