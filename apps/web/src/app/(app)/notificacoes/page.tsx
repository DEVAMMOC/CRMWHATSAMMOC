export default function NotificacoesPage() {
  return (
    <div style={{ padding: '32px', flex: 1 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 24 }}>🔔</span>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 800, color: 'var(--ammoc-ink-900)', margin: 0, letterSpacing: '-0.02em' }}>
            Notificações
          </h1>
          <span style={{ background: 'var(--ammoc-green)', color: 'white', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            Em construção
          </span>
        </div>
        <p style={{ color: 'var(--ammoc-ink-400)', fontSize: 13, margin: 0 }}>Alertas e avisos do sistema.</p>
      </div>
      <div style={{ background: 'var(--ammoc-paper)', border: '1.5px dashed var(--ammoc-line)', borderRadius: 12, padding: '48px 32px', textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔔</div>
        <div style={{ color: 'var(--ammoc-ink-400)', fontSize: 14 }}>Esta funcionalidade será implementada em breve.</div>
      </div>
    </div>
  );
}
