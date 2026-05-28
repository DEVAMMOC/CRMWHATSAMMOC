// apps/web/src/app/(app)/dashboard/page.tsx
export default function DashboardPage() {
  return (
    <div style={{ padding: '24px', flex: 1 }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '22px', marginBottom: '8px' }}>
        Minhas Conversas
      </h1>
      <p style={{ color: 'var(--ammoc-ink-400)', fontSize: '13px' }}>
        Fase 1 concluída ✓ — funcionalidades de WhatsApp chegam na Fase 2.
      </p>
    </div>
  );
}
