import { AiService } from './ai.service';
import { SupabaseClient } from '@supabase/supabase-js';

const supaWith = (cfg: Record<string, unknown> | null) =>
  ({
    from: () => ({
      select: () => ({ limit: () => ({ maybeSingle: async () => ({ data: cfg }) }) }),
    }),
  }) as unknown as SupabaseClient;

const ACTIVE = {
  model: 'gemini-2.5-flash-lite',
  api_key: 'k',
  system_prompt: null,
  temperature: 0.2,
  is_active: true,
  auto_summarize: true,
  classify_mode: 'suggest',
};

describe('AiService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('summarize devolve {contexto,resolucao} do JSON do Gemini', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '{"contexto":"ctx","resolucao":"res"}' }] } }] }),
    } as Response);
    const out = await new AiService(supaWith(ACTIVE)).summarize('Cidadão: oi');
    expect(out).toEqual({ contexto: 'ctx', resolucao: 'res' });
  });

  it('summarize retorna null se agente inativo', async () => {
    const out = await new AiService(supaWith({ ...ACTIVE, is_active: false })).summarize('x');
    expect(out).toBeNull();
  });

  it('classifySector escolhe um id válido', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '{"sector_id":"s1"}' }] } }] }),
    } as Response);
    const out = await new AiService(supaWith(ACTIVE)).classifySector('quero IPTU', [
      { id: 's1', name: 'Tributos' },
      { id: 's2', name: 'Obras' },
    ]);
    expect(out).toEqual({ sectorId: 's1' });
  });

  it('classifySector ignora id inexistente → null', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '{"sector_id":"xxx"}' }] } }] }),
    } as Response);
    const out = await new AiService(supaWith(ACTIVE)).classifySector('q', [{ id: 's1', name: 'A' }]);
    expect(out).toEqual({ sectorId: null });
  });

  it('classifySector não roda em modo off', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const out = await new AiService(supaWith({ ...ACTIVE, classify_mode: 'off' })).classifySector('q', [{ id: 's1', name: 'A' }]);
    expect(out).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
