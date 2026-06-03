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
      json: () => Promise.resolve({ data: { id: 'inst-1', name: 'user-abc', token: 'token-123' }, message: 'success' }),
      text: () => Promise.resolve(''),
    } as unknown as Response);
  });

  afterEach(() => { fetchSpy.mockRestore(); });

  it('createOrFindInstance posts to /instance/create with global apikey', async () => {
    const result = await service.createOrFindInstance('user-abc', 'token-123');
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://evo:8085/instance/create',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ apikey: 'test-key' }),
        body: JSON.stringify({ name: 'user-abc', token: 'token-123' }),
      }),
    );
    expect(result).toEqual({ id: 'inst-1', name: 'user-abc', token: 'token-123' });
  });

  it('createOrFindInstance returns existing instance when name already exists', async () => {
    // First call (create) returns 409 "already exists"
    fetchSpy
      .mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve('{"error":"instance already exists"}'),
      } as unknown as Response)
      // Second call (list all) returns the existing instance
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: [{ id: 'existing-id', name: 'user-abc', token: 'existing-token' }],
          message: 'success',
        }),
        text: () => Promise.resolve(''),
      } as unknown as Response);

    const result = await service.createOrFindInstance('user-abc', 'new-token');
    expect(result).toEqual({ id: 'existing-id', name: 'user-abc', token: 'existing-token' });
  });

  it('getQR sends instance token as apikey', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { Qrcode: 'data:image/png;base64,abc' }, message: 'success' }),
    } as unknown as Response);
    const result = await service.getQR('tok-1');
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://evo:8085/instance/qr',
      expect.objectContaining({
        headers: expect.objectContaining({ apikey: 'tok-1' }),
      }),
    );
    expect(result.base64).toBe('data:image/png;base64,abc');
  });

  it('throws when response is not ok (non-duplicate error)', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('internal error'),
    } as unknown as Response);
    await expect(service.createOrFindInstance('n', 't')).rejects.toThrow('Evolution create failed');
  });

  it('downloadMedia posts the Message to /message/downloadmedia and returns data.base64', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ message: 'success', data: { base64: 'data:image/jpeg;base64,aGk=' } }),
    } as unknown as Response);
    const out = await service.downloadMedia('tok-1', { imageMessage: { url: 'x' } });
    expect(out).toBe('data:image/jpeg;base64,aGk=');
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://evo:8085/message/downloadmedia',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ apikey: 'tok-1' }),
        body: JSON.stringify({ message: { imageMessage: { url: 'x' } } }),
      }),
    );
  });

  it('getStatus: LoggedIn=true → connected', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { Connected: true, LoggedIn: true, Name: 'Max' }, message: 'success' }),
    } as unknown as Response);
    expect((await service.getStatus('tok-1')).status).toBe('connected');
  });

  it('getStatus: instância nova (Connected=true, LoggedIn=false) → connecting (não connected)', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { Connected: true, LoggedIn: false, Name: '' }, message: 'success' }),
    } as unknown as Response);
    expect((await service.getStatus('tok-1')).status).toBe('connecting');
  });

  it('getStatus: Connected=false → disconnected', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { Connected: false, LoggedIn: false, Name: '' }, message: 'success' }),
    } as unknown as Response);
    expect((await service.getStatus('tok-1')).status).toBe('disconnected');
  });
});
