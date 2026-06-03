'use client';

import { useEffect, useState, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useIsMobile } from '@/lib/use-is-mobile';
import type { ConversationStatus } from '@crmwhats/types';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ConvRow {
  contact_name: string;
  contact_number: string;
  municipality: string | null;
  status: ConversationStatus;
  last_message_at: string | null;
}

interface Contact {
  contact_name: string;
  contact_number: string;
  municipality: string;
  status: ConversationStatus;
  last_message_at: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtPhone(raw: string) {
  const n = raw.replace(/\D/g, '');
  const m = n.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  if (m) return `+55 (${m[1]}) ${m[2]}-${m[3]}`;
  return raw;
}

function fmtDate(ts: string | null) {
  if (!ts) return '—';
  const d = new Date(ts);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `há ${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  pendente:  { bg: '#FEF3C7', color: '#D97706', label: 'Pendente' },
  ativa:     { bg: '#E6F0E5', color: '#166331', label: 'Ativa' },
  encerrada: { bg: '#ECEAE3', color: '#555555', label: 'Encerrada' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? { bg: '#ECEAE3', color: '#555555', label: status };
  return (
    <span style={{ background: s.bg, color: s.color, fontSize: 11, fontWeight: 700,
      padding: '2px 8px', borderRadius: 99, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ContatosPage() {
  const supabase = createClient();
  const isMobile = useIsMobile();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const { data, error: err } = await supabase
          .from('conversations')
          .select('contact_name, contact_number, municipality, status, last_message_at')
          .neq('status', 'nao_salva')
          .order('contact_name');

        if (err) throw err;

        // Deduplicate by contact_number, keeping most recent last_message_at
        const map = new Map<string, ConvRow>();
        for (const row of (data ?? []) as ConvRow[]) {
          const existing = map.get(row.contact_number);
          if (!existing) {
            map.set(row.contact_number, row);
          } else {
            const existTs = existing.last_message_at ? new Date(existing.last_message_at).getTime() : 0;
            const newTs = row.last_message_at ? new Date(row.last_message_at).getTime() : 0;
            if (newTs > existTs) map.set(row.contact_number, row);
          }
        }

        const deduped: Contact[] = Array.from(map.values()).map(r => ({
          ...r,
          municipality: r.municipality ?? 'Sem município',
        }));

        setContacts(deduped);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Erro ao carregar base.');
      } finally {
        setLoading(false);
      }
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return contacts;
    const q = search.toLowerCase();
    return contacts.filter(c =>
      c.contact_name.toLowerCase().includes(q) ||
      c.contact_number.includes(q) ||
      c.municipality.toLowerCase().includes(q)
    );
  }, [contacts, search]);

  // Group by municipality, alphabetically, "Sem município" last
  const groups = useMemo(() => {
    const map = new Map<string, Contact[]>();
    for (const c of filtered) {
      if (!map.has(c.municipality)) map.set(c.municipality, []);
      map.get(c.municipality)!.push(c);
    }
    const entries = Array.from(map.entries()).sort(([a], [b]) => {
      if (a === 'Sem município') return 1;
      if (b === 'Sem município') return -1;
      return a.localeCompare(b, 'pt-BR');
    });
    return entries;
  }, [filtered]);

  return (
    <div style={{ padding: isMobile ? 16 : '32px', flex: 1 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 20 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800,
          color: 'var(--ammoc-ink-900)', margin: 0, letterSpacing: '-0.02em' }}>
          Contatos
        </h1>
        {!loading && (
          <span style={{ fontSize: 13, color: 'var(--ammoc-ink-400)', fontFamily: 'var(--font-body)' }}>
            {contacts.length} {contacts.length === 1 ? 'contato' : 'contatos'}
          </span>
        )}
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Buscar contato ou município…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ width: '100%', border: '1.5px solid var(--ammoc-line)', borderRadius: 'var(--radius-sm)',
          padding: '9px 12px', fontSize: 14, outline: 'none', fontFamily: 'var(--font-body)',
          background: 'var(--ammoc-paper)', color: 'var(--ammoc-ink-900)', marginBottom: 16, boxSizing: 'border-box' }}
      />

      {/* Error */}
      {error && (
        <div style={{ background: '#FCEBE8', color: '#C0392B', padding: '10px 14px',
          borderRadius: 'var(--radius-sm)', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ color: 'var(--ammoc-ink-400)', fontSize: 14, padding: '32px 0', textAlign: 'center' }}>
          Carregando base…
        </div>
      )}

      {/* Groups */}
      {!loading && groups.length === 0 && (
        <div style={{ color: 'var(--ammoc-ink-400)', fontSize: 14, padding: '32px 0', textAlign: 'center' }}>
          Nenhum contato encontrado.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        {groups.map(([municipality, muniContacts]) => (
          <div key={municipality}>
            {/* Municipality header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ammoc-ink-900)',
                fontFamily: 'var(--font-display)' }}>
                {municipality}
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, background: 'var(--ammoc-green-100)',
                color: 'var(--ammoc-green-800)', padding: '1px 8px', borderRadius: 99 }}>
                {muniContacts.length}
              </span>
            </div>

            {/* Contact cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {muniContacts.map(c => (
                <div key={c.contact_number}
                  style={{ background: 'var(--ammoc-paper)', border: '1px solid var(--ammoc-line-2)',
                    borderRadius: 'var(--radius)', padding: '12px 16px',
                    display: 'flex', alignItems: 'center', gap: 12,
                    boxShadow: 'var(--shadow-card)' }}>
                  <span style={{ fontSize: 20, flexShrink: 0 }}>👤</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ammoc-ink-900)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.contact_name}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, color: 'var(--ammoc-ink-400)', fontFamily: 'var(--font-body)' }}>
                        {fmtPhone(c.contact_number)}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--ammoc-ink-400)' }}>
                        {fmtDate(c.last_message_at)}
                      </span>
                    </div>
                  </div>
                  <StatusBadge status={c.status} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
