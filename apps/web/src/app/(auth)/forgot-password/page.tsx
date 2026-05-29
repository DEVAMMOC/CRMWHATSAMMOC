'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import styles from '../login/login.module.css';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (!email.endsWith('@ammoc.org.br')) {
      setError('Somente emails @ammoc.org.br podem recuperar senha.');
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (resetError) {
      setError('Erro ao enviar email. Tente novamente.');
      setLoading(false);
      return;
    }

    setSent(true);
    setLoading(false);
  }

  if (sent) {
    return (
      <div className={styles.card}>
        <div className={styles.logo}>
          <div className={styles.logoMark}>
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <rect x="2" y="2" width="18" height="18" rx="5" fill="white" fillOpacity="0.15"/>
              <path d="M7 11h8M11 7v8" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          <div className={styles.logoText}>
            <h1>AMMOC</h1>
            <p>CRMWhats</p>
          </div>
        </div>

        <div className={styles.title}>Email enviado ✓</div>
        <div className={styles.subtitle}>
          Enviamos um link de recuperação para <strong>{email}</strong>. Verifique sua caixa de entrada (e spam).
        </div>

        <div style={{ marginTop: 24 }}>
          <Link href="/login" className={styles.submit} style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
            ← Voltar ao login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.logo}>
        <div className={styles.logoMark}>
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <rect x="2" y="2" width="18" height="18" rx="5" fill="white" fillOpacity="0.15"/>
            <path d="M7 11h8M11 7v8" stroke="white" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </div>
        <div className={styles.logoText}>
          <h1>AMMOC</h1>
          <p>CRMWhats</p>
        </div>
      </div>

      <div className={styles.title}>Recuperar senha</div>
      <div className={styles.subtitle}>
        Digite seu email institucional e enviaremos um link para redefinir sua senha.
      </div>

      <form onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="email">Email</label>
          <input
            id="email"
            className={styles.input}
            type="email"
            placeholder="seu@ammoc.org.br"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoComplete="email"
            autoFocus
          />
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <button
          className={styles.submit}
          type="submit"
          disabled={loading}
        >
          {loading ? 'Enviando...' : 'Enviar link de recuperação →'}
        </button>
      </form>

      <div style={{ marginTop: 16, textAlign: 'center' }}>
        <Link href="/login" style={{ fontSize: 13, color: 'var(--ammoc-ink-400)', textDecoration: 'none' }}>
          ← Voltar ao login
        </Link>
      </div>
    </div>
  );
}
