'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import styles from '../login/login.module.css';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Supabase sends the recovery token as a hash fragment (#access_token=...&type=recovery)
  // The client SDK picks it up automatically on mount
  useEffect(() => {
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setReady(true);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('A senha deve ter pelo menos 8 caracteres.');
      return;
    }
    if (password !== confirm) {
      setError('As senhas não coincidem.');
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError('Erro ao redefinir senha. O link pode ter expirado.');
      setLoading(false);
      return;
    }

    router.push('/dashboard');
  }

  if (!ready) {
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
        <div className={styles.title}>Verificando link...</div>
        <div className={styles.subtitle}>Aguarde um momento.</div>
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

      <div className={styles.title}>Nova senha</div>
      <div className={styles.subtitle}>Escolha uma senha segura de pelo menos 8 caracteres.</div>

      <form onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="password">Nova senha</label>
          <input
            id="password"
            className={styles.input}
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoFocus
            minLength={8}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="confirm">Confirmar senha</label>
          <input
            id="confirm"
            className={styles.input}
            type="password"
            placeholder="••••••••"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            required
            minLength={8}
          />
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <button
          className={styles.submit}
          type="submit"
          disabled={loading}
        >
          {loading ? 'Salvando...' : 'Redefinir senha →'}
        </button>
      </form>
    </div>
  );
}
