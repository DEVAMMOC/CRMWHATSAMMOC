# Responsividade Mobile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o CRMWhats usável no celular (≤768px) — menu vira gaveta com hambúrguer, telas split viram painel único, e as páginas se ajustam — sem mudar nenhuma funcionalidade.

**Architecture:** Um wrapper client `AppShellClient` gerencia o estado da gaveta (top bar + overlay + sidebar deslizante) via CSS media queries. Um hook `useIsMobile()` alterna a renderização das telas split (lista↔painel) e valores de layout. Ajustes responsivos nas páginas usam o hook (estilos inline) e media queries no CSS do shell.

**Tech Stack:** Next.js 15 (App Router) + React + TypeScript + CSS Modules.

**Spec:** [docs/superpowers/specs/2026-05-30-responsividade-mobile-design.md](../specs/2026-05-30-responsividade-mobile-design.md)

**Breakpoint:** `≤ 768px` = mobile. Desktop (>768px) deve ficar **idêntico** ao atual.

---

## File Structure

**Novos:**
- `apps/web/src/lib/use-is-mobile.ts` — hook `useIsMobile()`
- `apps/web/src/components/layout/AppShellClient.tsx` — shell client (drawer + top bar + overlay)

**Modificados:**
- `apps/web/src/components/layout/AppShell.tsx` — usar `AppShellClient`
- `apps/web/src/components/layout/AppShell.module.css` — responsivo (top bar, overlay, drawer, grid)
- `apps/web/src/components/layout/Sidebar.tsx` — aceitar `onNavigate` (fechar gaveta ao navegar)
- `apps/web/src/components/layout/Sidebar.module.css` — `.sidebar` como gaveta no mobile
- `apps/web/src/app/(app)/meu-numero/page.tsx` — split single-pane no mobile
- `apps/web/src/app/(app)/canal/page.tsx` — split single-pane no mobile
- `apps/web/src/app/(app)/dashboard/page.tsx` — padding/maxWidth responsivos
- `apps/web/src/app/(app)/canal/config/page.tsx` — responsivo
- `apps/web/src/app/(app)/configuracoes/setores/page.tsx` — responsivo

---

### Task 1: Hook `useIsMobile` + viewport

**Files:** Create `apps/web/src/lib/use-is-mobile.ts`; verify `apps/web/src/app/layout.tsx` viewport.

- [ ] **Step 1: Criar o hook**

`apps/web/src/lib/use-is-mobile.ts`:
```typescript
'use client';
import { useState, useEffect } from 'react';

/**
 * Retorna true quando a viewport tem largura ≤ breakpoint (default 768px).
 * SSR-safe: inicia false e atualiza no cliente após montar (evita mismatch de hidratação).
 */
export function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [breakpoint]);
  return isMobile;
}
```

- [ ] **Step 2: Confirmar viewport meta**

Ler `apps/web/src/app/layout.tsx`. Garantir que existe a viewport meta. Next 15 injeta por padrão, mas se NÃO houver, adicionar o export:
```typescript
import type { Viewport } from 'next';
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };
```
(Se já houver `viewport`/meta equivalente, não duplicar.)

- [ ] **Step 3: tsc + commit**
```bash
cd apps/web && npx tsc --noEmit
git add apps/web/src/lib/use-is-mobile.ts apps/web/src/app/layout.tsx
git commit -m "feat(web): add useIsMobile hook + ensure mobile viewport"
```
Esperado: tsc exit 0.

---

### Task 2: Shell responsivo (gaveta + top bar + overlay)

**Files:** Create `apps/web/src/components/layout/AppShellClient.tsx`; Modify `AppShell.tsx`, `AppShell.module.css`, `Sidebar.tsx`, `Sidebar.module.css`.

- [ ] **Step 1: Criar `AppShellClient.tsx`**

```tsx
'use client';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import type { AppUser } from '@crmwhats/types';
import styles from './AppShell.module.css';

export default function AppShellClient({ user, children }: { user: AppUser; children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  // Fecha a gaveta ao trocar de rota
  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  // Trava o scroll do body quando a gaveta está aberta (mobile)
  useEffect(() => {
    if (drawerOpen) { document.body.style.overflow = 'hidden'; }
    else { document.body.style.overflow = ''; }
    return () => { document.body.style.overflow = ''; };
  }, [drawerOpen]);

  return (
    <div className={styles.shell}>
      {/* Top bar — só aparece no mobile (controlado por CSS) */}
      <header className={styles.topbar}>
        <button type="button" className={styles.hamburger} aria-label="Abrir menu" onClick={() => setDrawerOpen(true)}>☰</button>
        <span className={styles.topbarBrand}>AMMOC <span className={styles.topbarSub}>CRMWhats</span></span>
      </header>

      {/* Overlay — só no mobile quando aberto */}
      {drawerOpen && <div className={styles.overlay} onClick={() => setDrawerOpen(false)} aria-hidden="true" />}

      {/* Sidebar — fixa no desktop; gaveta no mobile (classe drawerOpen) */}
      <div className={`${styles.sidebarWrap} ${drawerOpen ? styles.sidebarWrapOpen : ''}`}>
        <Sidebar user={user} onNavigate={() => setDrawerOpen(false)} />
      </div>

      <div className={styles.main}>{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: `AppShell.tsx` usar o client**

Substituir o conteúdo de `apps/web/src/components/layout/AppShell.tsx` por:
```tsx
// apps/web/src/components/layout/AppShell.tsx
import AppShellClient from './AppShellClient';
import type { AppUser } from '@crmwhats/types';

export default function AppShell({ user, children }: { user: AppUser; children: React.ReactNode }) {
  return <AppShellClient user={user}>{children}</AppShellClient>;
}
```

- [ ] **Step 3: `Sidebar.tsx` aceitar `onNavigate`**

Em `apps/web/src/components/layout/Sidebar.tsx`:
- Mudar a interface: `interface SidebarProps { user: AppUser; onNavigate?: () => void }` e a assinatura `export default function Sidebar({ user, onNavigate }: SidebarProps)`.
- Propagar `onNavigate` para os `NavLink`: mudar `NavLink` para aceitar `onNavigate?: () => void` e adicionar `onClick={onNavigate}` no `<Link>`. Passar `onNavigate={onNavigate}` em cada `<NavLink ... />`. Também chamar `onNavigate?.()` no `handleLogout` início (opcional).

- [ ] **Step 4: CSS do shell responsivo**

Substituir `apps/web/src/components/layout/AppShell.module.css` por:
```css
.shell {
  display: grid;
  grid-template-columns: 216px 1fr;
  min-height: 100vh;
  background: var(--ammoc-paper-2);
}
.main { display: flex; flex-direction: column; overflow: hidden; min-width: 0; }

/* Elementos só-mobile escondidos no desktop */
.topbar { display: none; }
.overlay { display: none; }
.sidebarWrap { min-width: 0; }

@media (max-width: 768px) {
  .shell { grid-template-columns: 1fr; }

  .topbar {
    display: flex; align-items: center; gap: 12px;
    height: 52px; padding: 0 14px;
    background: var(--ammoc-green, #128C7E); color: #fff;
    position: sticky; top: 0; z-index: 50;
  }
  .hamburger { background: none; border: none; color: #fff; font-size: 22px; line-height: 1; cursor: pointer; padding: 4px 8px; }
  .topbarBrand { font-weight: 800; font-size: 16px; }
  .topbarSub { font-weight: 500; opacity: .8; font-size: 12px; margin-left: 4px; }

  .overlay { display: block; position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 60; }

  /* Sidebar vira gaveta deslizante */
  .sidebarWrap {
    position: fixed; top: 0; left: 0; height: 100dvh; z-index: 70;
    transform: translateX(-100%); transition: transform .25s ease;
  }
  .sidebarWrapOpen { transform: translateX(0); }
}
```
NOTA: o desktop fica idêntico (top bar/overlay com `display:none`, grid `216px 1fr`, `sidebarWrap` sem position).

- [ ] **Step 5: CSS do Sidebar no mobile**

Ler `apps/web/src/components/layout/Sidebar.module.css`. Adicionar ao final um bloco para garantir que a `.sidebar` ocupe altura cheia dentro da gaveta no mobile (sem alterar o desktop):
```css
@media (max-width: 768px) {
  .sidebar { height: 100dvh; width: 240px; box-shadow: 2px 0 16px rgba(0,0,0,.25); }
}
```
(Se `.sidebar` já tiver `height: 100vh`/largura fixa, ajustar para não conflitar — manter o visual atual; só garantir que a gaveta tenha largura definida e sombra.)

- [ ] **Step 6: tsc + commit**
```bash
cd apps/web && npx tsc --noEmit
git add apps/web/src/components/layout/
git commit -m "feat(web): responsive shell — mobile drawer sidebar + top bar + overlay"
```
Esperado: tsc exit 0.

---

### Task 3: Telas split → painel único no mobile

**Files:** Modify `apps/web/src/app/(app)/meu-numero/page.tsx`, `apps/web/src/app/(app)/canal/page.tsx`.

- [ ] **Step 1: `meu-numero` — usar `useIsMobile`**

Em `apps/web/src/app/(app)/meu-numero/page.tsx`:
- Importar: `import { useIsMobile } from '@/lib/use-is-mobile';`
- Dentro do componente: `const isMobile = useIsMobile();`
- Localizar o container split da aba conversas (o `<div style={{ display:'flex', gap:16, ... height:'calc(100vh - 200px)' }}>` com a coluna esquerda `width:360` e a coluna direita do painel).
- Tornar single-pane no mobile:
  - Coluna ESQUERDA (lista): `style` ganha `display: isMobile && selectedConvId ? 'none' : 'flex'` e `width: isMobile ? '100%' : 360`.
  - Coluna DIREITA (painel): `style` ganha `display: isMobile && !selectedConvId ? 'none' : 'flex'` e (no mobile) ocupa 100%.
  - O container externo: no mobile usar `height: 'calc(100dvh - 140px)'` (descontando a top bar) e `flexDirection` continua row (só um filho visível por vez).
  - O `ConversationPanel` já tem `onBack` (← limpa `selectedConvId`) — garantir que o ← apareça no mobile (já é renderizado quando `onBack` é passado; manter passando `onBack`).

- [ ] **Step 2: `canal` — mesmo padrão**

Em `apps/web/src/app/(app)/canal/page.tsx`: aplicar exatamente a mesma lógica (`useIsMobile`, esconder lista quando uma conversa está selecionada no mobile, painel 100%, `CanalPanel` com `onBack`).

- [ ] **Step 3: tsc + commit**
```bash
cd apps/web && npx tsc --noEmit
git add "apps/web/src/app/(app)/meu-numero/page.tsx" "apps/web/src/app/(app)/canal/page.tsx"
git commit -m "feat(web): split views single-pane on mobile (Minhas Conversas, Canal)"
```
Esperado: tsc exit 0.

---

### Task 4: Ajustes responsivos das páginas

**Files:** Modify `dashboard/page.tsx`, `configuracoes/setores/page.tsx`, `canal/config/page.tsx` (e qualquer outra com padding/largura fixa que estoure).

- [ ] **Step 1: dashboard**

Em `apps/web/src/app/(app)/dashboard/page.tsx`:
- `import { useIsMobile } from '@/lib/use-is-mobile';` + `const isMobile = useIsMobile();`
- No container raiz da página, trocar `padding: 32`/`'32px'` por `padding: isMobile ? 16 : 32` e `maxWidth` fixo por `maxWidth: isMobile ? '100%' : <valor atual>`.
- Garantir que os cards de conversa e a barra de filtros/busca usem `width: 100%`/`flexWrap: 'wrap'` e não tenham largura fixa maior que a viewport. Inputs de busca `width: '100%'`/`boxSizing: 'border-box'`.

- [ ] **Step 2: setores**

Em `apps/web/src/app/(app)/configuracoes/setores/page.tsx`:
- `useIsMobile` + padding raiz `isMobile ? 16 : 32`, `maxWidth: isMobile ? '100%' : 800`.
- Modal "Novo/Editar Setor": largura `width: isMobile ? '92vw' : 440` e `maxWidth: '92vw'`.
- Linhas de setor/membros: `flexWrap: 'wrap'` onde necessário pra não estourar.

- [ ] **Step 3: canal/config**

Em `apps/web/src/app/(app)/canal/config/page.tsx`:
- `useIsMobile` + padding raiz `isMobile ? 16 : 32`, `maxWidth: isMobile ? '100%' : <atual>`.
- Inputs/forms `width: 100%`/`boxSizing: border-box`; lista de números com `flexWrap: 'wrap'`.

- [ ] **Step 4: varredura de overflow**

Procurar outras páginas com largura fixa que estoure no mobile:
```bash
cd "C:\Users\max_m\OneDrive\Área de Trabalho\GERENCIAMENTO WHATSAPP"
```
Inspecionar (Grep) por `maxWidth:` e `width: 3`/`width: 4`/`width: 5` (larguras fixas grandes em px) nas páginas de `apps/web/src/app/(app)/`. Para cada largura fixa ≥ ~360px num container de página, trocar por fluida (`width: '100%'`, `maxWidth: <valor>`). NÃO mexer em ícones/avatares pequenos.

- [ ] **Step 5: tsc + commit**
```bash
cd apps/web && npx tsc --noEmit
git add "apps/web/src/app/(app)"
git commit -m "feat(web): responsive padding/widths on dashboard, setores, canal config"
```
Esperado: tsc exit 0.

---

### Task 5: Deploy + verificação

- [ ] **Step 1: Push + deploy web**
```bash
git push origin master
curl -s "http://2.25.139.166:8000/api/v1/deploy?uuid=y664pro58rjywtieei0no3ua&force=false" -H "Authorization: Bearer 4|eapzDjDej8MwupomynOjKRtnV94SWwZM4ds9EK8s51423d3e"
```

- [ ] **Step 2: Verificar (após deploy)**
  - `https://crm.ammoc.org.br/login` → 200.
  - Em viewport ~375px (DevTools responsive ou celular): a top bar com ☰ aparece; tocar abre a gaveta; tocar no overlay/item fecha.
  - `/meu-numero` (Minhas Conversas) e `/canal`: lista em tela cheia; selecionar abre painel em tela cheia com ←.
  - `/dashboard`, `/configuracoes/setores`, `/canal/config`: sem scroll horizontal; conteúdo legível.
  - Desktop (largura normal): tudo idêntico ao anterior.

---

## Self-Review

**Cobertura da spec:**
- ✅ Gaveta + top bar + overlay no mobile, desktop inalterado (Task 2)
- ✅ `useIsMobile` + viewport (Task 1)
- ✅ Splits single-pane (Task 3)
- ✅ Padding/maxWidth/forms/modais responsivos (Task 4)
- ✅ Breakpoint 768px consistente (Tasks 1, 2, 3, 4)
- ✅ Sem mudança de funcionalidade (só layout)

**Placeholders:** estrutura (hook, AppShellClient, CSS) tem código completo. Task 4 descreve edições de estilo inline por página com regra concreta (padding `isMobile?16:32`, maxWidth fluido, modais `92vw`) — durante a execução cada implementer recebe o padrão exato; não há lógica nova, só valores de estilo.

**Consistência:** `useIsMobile` (Task 1) usado em Tasks 3/4; `onNavigate` (Task 2 Step 3) consistente entre Sidebar e AppShellClient; classes CSS (`topbar`, `overlay`, `sidebarWrap`, `sidebarWrapOpen`) consistentes entre AppShellClient (Task 2 Step 1) e AppShell.module.css (Task 2 Step 4); breakpoint 768px igual em todo lugar.

**Fora de escopo:** PWA, swipe, landscape, redesenho.
