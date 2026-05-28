import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { SupabaseAdminService } from './supabase-admin.service';

const mockSupabaseAdmin = {
  getUser: jest.fn(),
};

const makeContext = (authHeader?: string): ExecutionContext => ({
  switchToHttp: () => ({
    getRequest: () => ({
      headers: authHeader ? { authorization: authHeader } : {},
    }),
  }),
} as unknown as ExecutionContext);

describe('AuthGuard', () => {
  let guard: AuthGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new AuthGuard(mockSupabaseAdmin as unknown as SupabaseAdminService);
  });

  it('throws UnauthorizedException when no Authorization header', async () => {
    const ctx = makeContext();
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when token is invalid', async () => {
    mockSupabaseAdmin.getUser.mockResolvedValue({ data: { user: null }, error: new Error('invalid') });
    const ctx = makeContext('Bearer bad-token');
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('returns true and attaches user when token is valid', async () => {
    const fakeUser = { id: 'uuid-123', email: 'test@ammoc.org.br' };
    mockSupabaseAdmin.getUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer valid-token' } };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(req.user).toEqual(fakeUser);
    expect(mockSupabaseAdmin.getUser).toHaveBeenCalledWith('valid-token');
  });
});
