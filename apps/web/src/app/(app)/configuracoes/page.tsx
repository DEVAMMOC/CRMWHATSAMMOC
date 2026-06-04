'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useIsMobile } from '@/lib/use-is-mobile';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BotConfig {
  id?: string;
  is_active: boolean;
  instance_id: string;
  instance_token: string;
  provider: 'evolution_go' | 'meta_cloud' | 'twilio';
  welcome_message: string;
  delegate_by_municipality: boolean;
  auto_reply_after_hours: boolean;
  notify_on_delegation: boolean;
  updated_at?: string;
}

interface GithubConfig {
  id?: string;
  is_active: boolean;
  repo: string;
  branch: string;
  output_dir: string;
  pat_token: string;
  file_prefix: string;
  sync_time: string;
  generate_json: boolean;
  generate_md: boolean;
  generate_index: boolean;
  only_closed: boolean;
  last_sync_at?: string;
  last_sync_status?: 'success' | 'error' | 'pending';
  updated_at?: string;
}

interface AgentConfig {
  id?: string;
  is_active: boolean;
  model: string;
  api_key: string;
  temperature: number;
  system_prompt: string;
  suggest_replies: boolean;
  auto_summarize: boolean;
  classify_mode: string;
  updated_at?: string;
}

// ─── Toggle component ─────────────────────────────────────────────────────────

function Toggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      <div
        onClick={() => onChange(!value)}
        style={{
          width: 40,
          height: 22,
          borderRadius: 11,
          background: value ? 'var(--ammoc-green)' : 'var(--ammoc-line)',
          position: 'relative',
          transition: 'background 0.2s',
          flexShrink: 0,
          cursor: 'pointer',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 3,
            left: value ? 21 : 3,
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: 'white',
            transition: 'left 0.2s',
          }}
        />
      </div>
      <span style={{ fontSize: 14, color: 'var(--ammoc-ink-600)' }}>{label}</span>
    </label>
  );
}

// ─── Field wrapper ────────────────────────────────────────────────────────────

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label
        style={{
          display: 'block',
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--ammoc-ink-900)',
          marginBottom: 5,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: '1.5px solid var(--ammoc-line)',
  borderRadius: 'var(--radius-sm)',
  padding: '9px 12px',
  fontSize: 14,
  fontFamily: 'var(--font-body)',
  background: 'var(--ammoc-paper)',
  color: 'var(--ammoc-ink-900)',
  outline: 'none',
  boxSizing: 'border-box',
};

const cardStyle: React.CSSProperties = {
  background: 'var(--ammoc-paper)',
  border: '1px solid var(--ammoc-line-2)',
  borderRadius: 'var(--radius)',
  padding: '24px',
  marginBottom: 16,
};

// ─── Default states ───────────────────────────────────────────────────────────

const defaultBot: BotConfig = {
  is_active: false,
  instance_id: '',
  instance_token: '',
  provider: 'evolution_go',
  welcome_message: '',
  delegate_by_municipality: false,
  auto_reply_after_hours: false,
  notify_on_delegation: false,
};

const defaultGithub: GithubConfig = {
  is_active: false,
  repo: '',
  branch: 'main',
  output_dir: 'context/',
  pat_token: '',
  file_prefix: 'ammoc-conv-',
  sync_time: '03:00',
  generate_json: true,
  generate_md: true,
  generate_index: true,
  only_closed: false,
};

const defaultAgent: AgentConfig = {
  is_active: false,
  model: 'gpt-4o',
  api_key: '',
  temperature: 0.7,
  system_prompt: '',
  suggest_replies: false,
  auto_summarize: false,
  classify_mode: 'off',
};

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function ConfiguracoesPage() {
  const supabase = createClient();
  const isMobile = useIsMobile();

  const [activeTab, setActiveTab] = useState<'bot' | 'github' | 'agente'>('bot');

  const [bot, setBot] = useState<BotConfig>(defaultBot);
  const [github, setGithub] = useState<GithubConfig>(defaultGithub);
  const [agent, setAgent] = useState<AgentConfig>(defaultAgent);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  // ── Load configs ────────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true);
      const [botRes, ghRes, agentRes] = await Promise.all([
        supabase.from('bot_config').select('*').limit(1).maybeSingle(),
        supabase.from('github_sync_config').select('*').limit(1).maybeSingle(),
        supabase.from('agent_config').select('*').limit(1).maybeSingle(),
      ]);
      if (botRes.data) setBot(botRes.data as BotConfig);
      if (ghRes.data) setGithub(ghRes.data as GithubConfig);
      if (agentRes.data) setAgent(agentRes.data as AgentConfig);
      setLoading(false);
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Generic upsert helper ────────────────────────────────────────────────────
  async function upsert(
    table: string,
    data: Record<string, unknown>,
    existingId?: string
  ) {
    setSaving(true);
    setFeedback(null);
    try {
      const payload = { ...data, updated_at: new Date().toISOString() };
      let error;
      if (existingId) {
        ({ error } = await supabase.from(table).update(payload).eq('id', existingId));
      } else {
        ({ error } = await supabase.from(table).insert(payload));
      }
      if (error) throw error;
      setFeedback({ ok: true, msg: 'Configurações salvas com sucesso.' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro ao salvar configurações.';
      setFeedback({ ok: false, msg: message });
    } finally {
      setSaving(false);
      setTimeout(() => setFeedback(null), 4000);
    }
  }

  // ── Tab button style ─────────────────────────────────────────────────────────
  function tabStyle(tab: 'bot' | 'github' | 'agente'): React.CSSProperties {
    const active = activeTab === tab;
    return {
      padding: '8px 20px',
      borderRadius: 'var(--radius-sm)',
      fontSize: 13,
      fontWeight: 600,
      cursor: 'pointer',
      background: active ? 'var(--ammoc-green)' : 'var(--ammoc-paper-2)',
      color: active ? 'white' : 'var(--ammoc-ink-600)',
      border: active ? 'none' : '1px solid var(--ammoc-line-2)',
      transition: 'all 0.15s',
    };
  }

  if (loading) {
    return (
      <div style={{ padding: '32px', flex: 1, color: 'var(--ammoc-ink-400)', fontSize: 14 }}>
        Carregando configurações...
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: isMobile ? 16 : '32px', flex: 1, maxWidth: isMobile ? '100%' : 720 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 22,
            fontWeight: 800,
            color: 'var(--ammoc-ink-900)',
            margin: '0 0 4px',
            letterSpacing: '-0.02em',
          }}
        >
          Configurações
        </h1>
        <p style={{ color: 'var(--ammoc-ink-400)', fontSize: 13, margin: 0 }}>
          Apenas administradores podem alterar configurações do sistema.
        </p>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        <button style={tabStyle('bot')} onClick={() => setActiveTab('bot')}>
          Bot WhatsApp
        </button>
        <button style={tabStyle('github')} onClick={() => setActiveTab('github')}>
          Sincronização GitHub
        </button>
        <button style={tabStyle('agente')} onClick={() => setActiveTab('agente')}>
          Agente IA
        </button>
      </div>

      {/* Feedback */}
      {feedback && (
        <div
          style={{
            background: feedback.ok ? 'var(--ammoc-green-100)' : 'var(--ammoc-red-100)',
            color: feedback.ok ? 'var(--ammoc-green-800)' : 'var(--ammoc-red-700)',
            border: `1px solid ${feedback.ok ? 'var(--ammoc-green)' : 'var(--ammoc-red)'}`,
            borderRadius: 'var(--radius-sm)',
            padding: '10px 16px',
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 20,
          }}
        >
          {feedback.msg}
        </div>
      )}

      {/* ─── TAB: Bot WhatsApp ────────────────────────────────────────────────── */}
      {activeTab === 'bot' && (
        <div style={cardStyle}>
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 16,
              fontWeight: 700,
              color: 'var(--ammoc-ink-900)',
              margin: '0 0 20px',
            }}
          >
            Bot WhatsApp
          </h2>

          <div style={{ marginBottom: 20 }}>
            <Toggle
              value={bot.is_active}
              onChange={(v) => setBot({ ...bot, is_active: v })}
              label="Ativar bot AMMOC"
            />
          </div>

          <Field label="Provedor">
            <select
              value={bot.provider}
              onChange={(e) =>
                setBot({ ...bot, provider: e.target.value as BotConfig['provider'] })
              }
              style={inputStyle}
            >
              <option value="evolution_go">Evolution Go</option>
              <option value="meta_cloud">Meta Cloud</option>
              <option value="twilio">Twilio</option>
            </select>
          </Field>

          <Field label="ID da instância">
            <input
              type="text"
              value={bot.instance_id}
              onChange={(e) => setBot({ ...bot, instance_id: e.target.value })}
              style={inputStyle}
              placeholder="ex: ammoc-bot-01"
            />
          </Field>

          <Field label="Token da instância">
            <input
              type="password"
              value={bot.instance_token}
              onChange={(e) => setBot({ ...bot, instance_token: e.target.value })}
              style={inputStyle}
              placeholder="Token secreto"
            />
          </Field>

          <Field label="Mensagem de boas-vindas">
            <textarea
              value={bot.welcome_message}
              onChange={(e) => setBot({ ...bot, welcome_message: e.target.value })}
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
              placeholder="Olá! Bem-vindo(a) ao atendimento AMMOC..."
            />
          </Field>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
            <Toggle
              value={bot.delegate_by_municipality}
              onChange={(v) => setBot({ ...bot, delegate_by_municipality: v })}
              label="Delegar por município"
            />
            <Toggle
              value={bot.auto_reply_after_hours}
              onChange={(v) => setBot({ ...bot, auto_reply_after_hours: v })}
              label="Resposta automática fora do horário"
            />
            <Toggle
              value={bot.notify_on_delegation}
              onChange={(v) => setBot({ ...bot, notify_on_delegation: v })}
              label="Notificar ao delegar"
            />
          </div>

          <button
            onClick={() => upsert('bot_config', bot as unknown as Record<string, unknown>, bot.id)}
            disabled={saving}
            style={{
              background: 'var(--ammoc-green)',
              color: 'white',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 24px',
              fontSize: 14,
              fontWeight: 700,
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Salvando...' : 'Salvar configurações'}
          </button>
        </div>
      )}

      {/* ─── TAB: GitHub Sync ─────────────────────────────────────────────────── */}
      {activeTab === 'github' && (
        <div style={cardStyle}>
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 16,
              fontWeight: 700,
              color: 'var(--ammoc-ink-900)',
              margin: '0 0 20px',
            }}
          >
            Sincronização GitHub
          </h2>

          {/* Last sync status */}
          {github.last_sync_at && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 20,
                padding: '10px 14px',
                background: 'var(--ammoc-paper-2)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--ammoc-line-2)',
              }}
            >
              <span style={{ fontSize: 12, color: 'var(--ammoc-ink-600)' }}>
                Último sync:
              </span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  padding: '2px 10px',
                  borderRadius: 99,
                  background:
                    github.last_sync_status === 'success'
                      ? 'var(--ammoc-green-100)'
                      : github.last_sync_status === 'error'
                      ? 'var(--ammoc-red-100)'
                      : 'var(--color-yellow-bg)',
                  color:
                    github.last_sync_status === 'success'
                      ? 'var(--ammoc-green-800)'
                      : github.last_sync_status === 'error'
                      ? 'var(--ammoc-red-700)'
                      : 'var(--color-yellow)',
                }}
              >
                {github.last_sync_status === 'success'
                  ? 'Sucesso'
                  : github.last_sync_status === 'error'
                  ? 'Erro'
                  : 'Pendente'}
              </span>
              <span style={{ fontSize: 12, color: 'var(--ammoc-ink-400)' }}>
                {new Date(github.last_sync_at).toLocaleString('pt-BR')}
              </span>
            </div>
          )}

          <div style={{ marginBottom: 20 }}>
            <Toggle
              value={github.is_active}
              onChange={(v) => setGithub({ ...github, is_active: v })}
              label="Ativar sync automático"
            />
          </div>

          <Field label="Repositório (owner/repo)">
            <input
              type="text"
              value={github.repo}
              onChange={(e) => setGithub({ ...github, repo: e.target.value })}
              style={inputStyle}
              placeholder="DEVAMMOC/context-ammoc"
            />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Branch">
              <input
                type="text"
                value={github.branch}
                onChange={(e) => setGithub({ ...github, branch: e.target.value })}
                style={inputStyle}
                placeholder="main"
              />
            </Field>
            <Field label="Pasta de saída">
              <input
                type="text"
                value={github.output_dir}
                onChange={(e) => setGithub({ ...github, output_dir: e.target.value })}
                style={inputStyle}
                placeholder="context/"
              />
            </Field>
          </div>

          <Field label="GitHub PAT Token">
            <input
              type="password"
              value={github.pat_token}
              onChange={(e) => setGithub({ ...github, pat_token: e.target.value })}
              style={inputStyle}
              placeholder="ghp_..."
            />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Prefixo dos arquivos">
              <input
                type="text"
                value={github.file_prefix}
                onChange={(e) => setGithub({ ...github, file_prefix: e.target.value })}
                style={inputStyle}
                placeholder="ammoc-conv-"
              />
            </Field>
            <Field label="Horário do sync">
              <input
                type="time"
                value={github.sync_time}
                onChange={(e) => setGithub({ ...github, sync_time: e.target.value })}
                style={inputStyle}
              />
            </Field>
          </div>

          {/* Checkboxes */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
              marginBottom: 24,
            }}
          >
            {(
              [
                { key: 'generate_json', label: 'Gerar JSON' },
                { key: 'generate_md', label: 'Gerar Markdown' },
                { key: 'generate_index', label: 'Gerar índice' },
                { key: 'only_closed', label: 'Apenas conversas encerradas' },
              ] as Array<{ key: keyof GithubConfig; label: string }>
            ).map(({ key, label }) => (
              <label
                key={key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 14,
                  color: 'var(--ammoc-ink-600)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={github[key] as boolean}
                  onChange={(e) => setGithub({ ...github, [key]: e.target.checked })}
                  style={{ accentColor: 'var(--ammoc-green)', width: 16, height: 16 }}
                />
                {label}
              </label>
            ))}
          </div>

          <button
            onClick={() =>
              upsert(
                'github_sync_config',
                github as unknown as Record<string, unknown>,
                github.id
              )
            }
            disabled={saving}
            style={{
              background: 'var(--ammoc-green)',
              color: 'white',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 24px',
              fontSize: 14,
              fontWeight: 700,
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Salvando...' : 'Salvar configurações'}
          </button>
        </div>
      )}

      {/* ─── TAB: Agente IA ──────────────────────────────────────────────────── */}
      {activeTab === 'agente' && (
        <div style={cardStyle}>
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 16,
              fontWeight: 700,
              color: 'var(--ammoc-ink-900)',
              margin: '0 0 20px',
            }}
          >
            Agente IA
          </h2>

          <div style={{ marginBottom: 20 }}>
            <Toggle
              value={agent.is_active}
              onChange={(v) => setAgent({ ...agent, is_active: v })}
              label="Ativar agente IA"
            />
          </div>

          <Field label="Modelo">
            <select
              value={agent.model}
              onChange={(e) => setAgent({ ...agent, model: e.target.value })}
              style={inputStyle}
            >
              <option value="gpt-4o">gpt-4o</option>
              <option value="gpt-4o-mini">gpt-4o-mini</option>
              <option value="claude-3-5-sonnet">claude-3-5-sonnet</option>
              <option value="claude-3-haiku">claude-3-haiku</option>
              <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite (mais barato)</option>
              <option value="gemini-2.5-flash">gemini-2.5-flash</option>
              <option value="gemini-2.5-pro">gemini-2.5-pro</option>
              <option value="gemini-1.5-pro">gemini-1.5-pro</option>
            </select>
          </Field>

          <Field label="Chave de API">
            <input
              type="password"
              value={agent.api_key}
              onChange={(e) => setAgent({ ...agent, api_key: e.target.value })}
              style={inputStyle}
              placeholder="sk-..."
            />
          </Field>

          {/* Temperature slider */}
          <Field label={`Temperatura — ${agent.temperature.toFixed(2)}`}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={agent.temperature}
                onChange={(e) => setAgent({ ...agent, temperature: parseFloat(e.target.value) })}
                style={{ flex: 1, accentColor: 'var(--ammoc-green)' }}
              />
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={agent.temperature}
                onChange={(e) => setAgent({ ...agent, temperature: parseFloat(e.target.value) })}
                style={{ ...inputStyle, width: 72, textAlign: 'center' }}
              />
            </div>
          </Field>

          <Field label="Prompt do sistema">
            <textarea
              value={agent.system_prompt}
              onChange={(e) => setAgent({ ...agent, system_prompt: e.target.value })}
              rows={6}
              style={{ ...inputStyle, resize: 'vertical' }}
              placeholder="Você é um assistente especializado em atendimento ao cidadão..."
            />
          </Field>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
            <Toggle
              value={agent.suggest_replies}
              onChange={(v) => setAgent({ ...agent, suggest_replies: v })}
              label="Sugerir respostas durante atendimento"
            />
            <Toggle
              value={agent.auto_summarize}
              onChange={(v) => setAgent({ ...agent, auto_summarize: v })}
              label="Resumo automático ao encerrar"
            />
          </div>

          <Field label="Classificação por IA">
            <select
              value={agent.classify_mode}
              onChange={(e) => setAgent({ ...agent, classify_mode: e.target.value })}
              style={inputStyle}
            >
              <option value="off">Desligada</option>
              <option value="manual">Só no botão (manual)</option>
              <option value="suggest">Sugerir setor automaticamente</option>
              <option value="auto">Delegar ao setor automaticamente</option>
            </select>
          </Field>

          <button
            onClick={() =>
              upsert('agent_config', agent as unknown as Record<string, unknown>, agent.id)
            }
            disabled={saving}
            style={{
              background: 'var(--ammoc-green)',
              color: 'white',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 24px',
              fontSize: 14,
              fontWeight: 700,
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Salvando...' : 'Salvar configurações'}
          </button>
        </div>
      )}
    </div>
  );
}
