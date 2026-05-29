'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { AppUser } from '@crmwhats/types';

const cardStyle: React.CSSProperties = {
  background: 'var(--ammoc-paper)',
  border: '1px solid var(--ammoc-line-2)',
  borderRadius: 'var(--radius)',
  padding: '24px',
  marginBottom: 16,
};

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

export default function MeuNumeroPage() {
  const supabase = createClient();

  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  // ── Load user ──────────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data: authData } = await supabase.auth.getUser();
      const uid = authData.user?.id;
      if (!uid) {
        setLoading(false);
        return;
      }
      const { data } = await supabase.from('users').select('*').eq('id', uid).single();
      if (data) {
        setUser(data as AppUser);
        setWhatsappNumber(data.whatsapp_number ?? '');
      }
      setLoading(false);
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Save number ────────────────────────────────────────────────────────────
  async function saveNumber() {
    if (!user) return;
    setSaving(true);
    setFeedback(null);
    const { error } = await supabase
      .from('users')
      .update({ whatsapp_number: whatsappNumber })
      .eq('id', user.id);
    if (error) {
      setFeedback({ ok: false, msg: error.message });
    } else {
      setUser({ ...user, whatsapp_number: whatsappNumber });
      setFeedback({ ok: true, msg: 'Número atualizado com sucesso.' });
      setEditMode(false);
    }
    setSaving(false);
    setTimeout(() => setFeedback(null), 4000);
  }

  const isConfigured = !!(user?.evolution_instance_id);

  if (loading) {
    return (
      <div style={{ padding: '32px', flex: 1, color: 'var(--ammoc-ink-400)', fontSize: 14 }}>
        Carregando...
      </div>
    );
  }

  return (
    <div style={{ padding: '32px', flex: 1, maxWidth: 680 }}>
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
          Meu Número WhatsApp
        </h1>
        <p style={{ color: 'var(--ammoc-ink-400)', fontSize: 13, margin: 0 }}>
          Visualize e atualize seu número WhatsApp vinculado ao CRMWhats AMMOC.
        </p>
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
            marginBottom: 16,
          }}
        >
          {feedback.msg}
        </div>
      )}

      {/* ── Status card ───────────────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: isConfigured ? 'var(--ammoc-green-100)' : 'var(--color-yellow-bg)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
                flexShrink: 0,
              }}
            >
              {isConfigured ? '✅' : '⚠️'}
            </div>
            <div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: 'var(--ammoc-ink-900)',
                  marginBottom: 4,
                }}
              >
                {isConfigured ? 'Número configurado' : 'Número não configurado'}
              </div>
              {isConfigured ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 13, color: 'var(--ammoc-ink-600)' }}>
                    <strong>Número:</strong> {user?.whatsapp_number ?? '—'}
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--ammoc-ink-600)' }}>
                    <strong>Instância:</strong> {user?.evolution_instance_id}
                  </span>
                </div>
              ) : (
                <span style={{ fontSize: 13, color: 'var(--ammoc-ink-600)' }}>
                  Informe seu número para que o administrador configure sua instância.
                </span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            {/* Status badge */}
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                padding: '4px 12px',
                borderRadius: 99,
                background: isConfigured ? 'var(--ammoc-green-100)' : 'var(--color-yellow-bg)',
                color: isConfigured ? 'var(--ammoc-green-800)' : 'var(--color-yellow)',
              }}
            >
              {isConfigured ? 'Conectado' : 'Não conectado'}
            </span>
            {/* Action button */}
            <button
              onClick={() => setEditMode(true)}
              style={{
                background: 'var(--ammoc-green)',
                color: 'white',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {isConfigured ? 'Atualizar número' : 'Configurar número'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Info box: Evolution Go note ──────────────────────────────────────── */}
      <div
        style={{
          ...cardStyle,
          background: 'var(--color-blue-bg)',
          border: '1px solid #BFDBFE',
        }}
      >
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 18, flexShrink: 0 }}>ℹ️</span>
          <div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--color-blue)',
                marginBottom: 4,
              }}
            >
              Ativação via Evolution Go
            </div>
            <div style={{ fontSize: 13, color: 'var(--ammoc-ink-600)', lineHeight: 1.5 }}>
              A ativação da instância é feita pelo administrador do sistema na seção de{' '}
              <strong>Configurações</strong>.
            </div>
          </div>
        </div>
      </div>

      {/* ── Edit / configure form ────────────────────────────────────────────── */}
      {(editMode || !isConfigured) && (
        <div style={cardStyle}>
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 16,
              fontWeight: 700,
              color: 'var(--ammoc-ink-900)',
              margin: '0 0 16px',
            }}
          >
            Informar número WhatsApp
          </h2>

          <div style={{ marginBottom: 8 }}>
            <label
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--ammoc-ink-900)',
                marginBottom: 5,
              }}
            >
              Número WhatsApp (com DDD)
            </label>
            <input
              type="tel"
              value={whatsappNumber}
              onChange={(e) => setWhatsappNumber(e.target.value)}
              style={inputStyle}
              placeholder="+55 47 99999-9999"
            />
          </div>

          <p style={{ fontSize: 12, color: 'var(--ammoc-ink-400)', margin: '0 0 20px', lineHeight: 1.5 }}>
            Informe seu número para que o administrador configure sua instância Evolution Go.
          </p>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={saveNumber}
              disabled={saving || !whatsappNumber.trim()}
              style={{
                background: 'var(--ammoc-green)',
                color: 'white',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                padding: '10px 24px',
                fontSize: 14,
                fontWeight: 700,
                cursor: saving || !whatsappNumber.trim() ? 'not-allowed' : 'pointer',
                opacity: saving || !whatsappNumber.trim() ? 0.6 : 1,
              }}
            >
              {saving ? 'Salvando...' : 'Salvar número'}
            </button>

            {editMode && (
              <button
                onClick={() => {
                  setEditMode(false);
                  setWhatsappNumber(user?.whatsapp_number ?? '');
                }}
                style={{
                  background: 'var(--ammoc-paper-2)',
                  color: 'var(--ammoc-ink-600)',
                  border: '1px solid var(--ammoc-line-2)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '10px 20px',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancelar
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Instructions card ────────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 15,
            fontWeight: 700,
            color: 'var(--ammoc-ink-900)',
            margin: '0 0 16px',
          }}
        >
          Como funciona
        </h2>
        <ol style={{ margin: 0, padding: '0 0 0 4px', listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[
            { icon: '📱', text: 'Configure seu número WhatsApp nesta página' },
            { icon: '🔗', text: 'O sistema criará uma instância no Evolution Go' },
            { icon: '💬', text: 'Suas conversas serão capturadas e organizadas automaticamente' },
            { icon: '📊', text: 'Acompanhe tudo no painel de Conversas' },
          ].map((step, i) => (
            <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: 'var(--ammoc-green-100)',
                  color: 'var(--ammoc-green-800)',
                  fontSize: 11,
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {i + 1}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>{step.icon}</span>
                <span style={{ fontSize: 14, color: 'var(--ammoc-ink-600)', lineHeight: 1.4 }}>
                  {step.text}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
