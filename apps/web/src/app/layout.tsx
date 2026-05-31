import type { Metadata, Viewport } from 'next';
import '@/styles/globals.css';

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export const metadata: Metadata = {
  title: 'AMMOC CRMWhats',
  description: 'Sistema de gestão de WhatsApp da AMMOC',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
