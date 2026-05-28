import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';

// Mock the Supabase query chain
const mockSingle = jest.fn();
const mockSupabase = {
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  order: jest.fn().mockReturnThis(),
  single: mockSingle,
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(() => {
    jest.resetAllMocks();
    // Re-apply chainable mocks after reset
    mockSupabase.from.mockReturnThis();
    mockSupabase.select.mockReturnThis();
    mockSupabase.update.mockReturnThis();
    mockSupabase.eq.mockReturnThis();
    mockSupabase.order.mockReturnThis();
    service = new UsersService(mockSupabase as never);
  });

  it('findById returns user data when found', async () => {
    const fakeUser = { id: 'uuid-1', email: 'test@ammoc.org.br', name: 'Test', role: 'funcionario' };
    mockSingle.mockResolvedValue({ data: fakeUser, error: null });

    const result = await service.findById('uuid-1');
    expect(result).toEqual(fakeUser);
    expect(mockSupabase.from).toHaveBeenCalledWith('users');
  });

  it('findById throws Error when DB returns error', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'not found' } });
    await expect(service.findById('bad-id')).rejects.toThrow('not found');
  });

  it('findById throws NotFoundException when data is null and no DB error', async () => {
    mockSingle.mockResolvedValue({ data: null, error: null });
    await expect(service.findById('bad-id')).rejects.toThrow(NotFoundException);
  });

  it('updateProfile returns updated user', async () => {
    const updated = { id: 'uuid-1', name: 'Novo Nome', email: 'test@ammoc.org.br' };
    mockSingle.mockResolvedValue({ data: updated, error: null });

    const result = await service.updateProfile('uuid-1', { name: 'Novo Nome' });
    expect(result).toEqual(updated);
  });

  it('findAll returns array of users', async () => {
    const fakeUsers = [
      { id: 'uuid-1', name: 'Alice', role: 'funcionario' },
      { id: 'uuid-2', name: 'Bob', role: 'admin' },
    ];
    // findAll uses .order() which returns data directly (no .single())
    mockSupabase.order.mockResolvedValue({ data: fakeUsers, error: null });

    const result = await service.findAll();
    expect(result).toEqual(fakeUsers);
    expect(mockSupabase.from).toHaveBeenCalledWith('users');
  });

  it('setOnline throws when DB returns error', async () => {
    mockSupabase.eq.mockResolvedValue({ error: { message: 'db error' } });
    await expect(service.setOnline('uuid-1', true)).rejects.toThrow('db error');
  });
});
