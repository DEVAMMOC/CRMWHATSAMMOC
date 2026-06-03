import { SupabaseAdminService } from './supabase-admin.service';
import { ConfigService } from '@nestjs/config';

const cfg = { getOrThrow: (k: string) => k.includes('url') ? 'http://localhost' : 'service-role-key' } as unknown as ConfigService;

describe('SupabaseAdminService.deleteAuthUser', () => {
  it('chama auth.admin.deleteUser e lança em erro', async () => {
    const svc = new SupabaseAdminService(cfg);
    const del = jest.fn().mockResolvedValue({ data: {}, error: null });
    (svc as unknown as { client: { auth: { admin: { deleteUser: jest.Mock } } } }).client = {
      auth: { admin: { deleteUser: del } },
    };
    await svc.deleteAuthUser('uid-1');
    expect(del).toHaveBeenCalledWith('uid-1');

    del.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(svc.deleteAuthUser('uid-2')).rejects.toThrow('boom');
  });
});
