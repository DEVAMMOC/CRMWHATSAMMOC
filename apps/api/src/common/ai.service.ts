import { Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface AgentCfg {
  model: string;
  api_key: string;
  system_prompt: string | null;
  temperature: number | null;
  is_active: boolean;
  auto_summarize: boolean;
  classify_mode: string; // off | manual | suggest | auto
}

/**
 * Cliente do agente de IA (Gemini, API REST generativelanguage). Lê modelo/chave/
 * prompt de `agent_config`. Usado para resumir conversas e classificar por setor.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  constructor(private readonly supabase: SupabaseClient) {}

  /** Config ativa (com chave) ou null. */
  async config(): Promise<AgentCfg | null> {
    const { data } = await this.supabase
      .from('agent_config')
      .select('model, api_key, system_prompt, temperature, is_active, auto_summarize, classify_mode')
      .limit(1)
      .maybeSingle();
    const c = data as AgentCfg | null;
    return c && c.is_active && c.api_key ? c : null;
  }

  private async generate(cfg: AgentCfg, prompt: string, jsonMode = false): Promise<string | null> {
    const body: Record<string, unknown> = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: cfg.temperature ?? 0.2,
        ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
      },
    };
    if (cfg.system_prompt) body.systemInstruction = { parts: [{ text: cfg.system_prompt }] };
    const res = await fetch(`${GEMINI}/${cfg.model}:generateContent?key=${cfg.api_key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      this.logger.warn(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const j = (await res.json().catch(() => ({}))) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return j.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  }

  /** Resumo do atendimento → { contexto, resolucao } (ou null se IA off/erro). */
  async summarize(transcript: string): Promise<{ contexto: string; resolucao: string } | null> {
    const cfg = await this.config();
    if (!cfg || !cfg.auto_summarize) return null;
    const prompt =
      'Resuma este atendimento de WhatsApp de um cidadão. Responda APENAS em JSON ' +
      '{"contexto":"...","resolucao":"..."}. contexto = o que o cidadão pediu/situação ' +
      '(2-4 frases). resolucao = como foi resolvido/encaminhado (1-3 frases; se em aberto, diga).' +
      `\n\nTRANSCRIÇÃO:\n${transcript.slice(0, 8000)}`;
    const out = await this.generate(cfg, prompt, true);
    if (!out) return null;
    try {
      const j = JSON.parse(out) as { contexto?: string; resolucao?: string };
      if (j.contexto || j.resolucao)
        return { contexto: String(j.contexto ?? ''), resolucao: String(j.resolucao ?? '') };
    } catch {
      /* ignore parse */
    }
    return null;
  }

  /** Classifica o atendimento em um dos setores → { sectorId } (id válido ou null). */
  async classifySector(
    text: string,
    sectors: Array<{ id: string; name: string }>,
  ): Promise<{ sectorId: string | null } | null> {
    const cfg = await this.config();
    if (!cfg || cfg.classify_mode === 'off' || sectors.length === 0) return null;
    const list = sectors.map((s) => `- ${s.name} (id: ${s.id})`).join('\n');
    const prompt =
      'Classifique o atendimento em UM dos setores. Responda APENAS em JSON ' +
      '{"sector_id":"<id ou null>"}. Se nenhum servir, use null.' +
      `\n\nSETORES:\n${list}\n\nATENDIMENTO:\n${text.slice(0, 4000)}`;
    const out = await this.generate(cfg, prompt, true);
    if (!out) return null;
    try {
      const j = JSON.parse(out) as { sector_id?: string | null };
      const id = j.sector_id && sectors.some((s) => s.id === j.sector_id) ? j.sector_id : null;
      return { sectorId: id };
    } catch {
      return null;
    }
  }
}
