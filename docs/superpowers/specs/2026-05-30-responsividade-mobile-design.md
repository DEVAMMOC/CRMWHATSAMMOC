# Responsividade Mobile — Design Spec

**Data:** 2026-05-30
**Status:** Aprovado

## Objetivo

Tornar o CRMWhats usável no celular sem mudar nenhuma funcionalidade — apenas layout/CSS. Breakpoint: **≤ 768px = mobile**; acima, o desktop permanece idêntico ao atual.

## Decisões (brainstorming)
- Menu mobile: **gaveta com hambúrguer** (desliza da esquerda, overlay escuro). Mantém todos os itens/seções.
- Alcance: **sistema todo**.

## Componentes

### 1. Shell + menu
- `AppShell` hoje é grid `216px 1fr` (server) + `Sidebar` (client).
- **Mobile:** coluna única. Uma **barra superior** com botão **☰** + logo. O `Sidebar` vira **gaveta** (`position: fixed; transform: translateX(-100%)` → `0` quando aberto) com **overlay**. Fecha ao: tocar num item, tocar no overlay, ou trocar de rota (`usePathname` effect).
- **Desktop:** barra superior e overlay ficam ocultos (media query); sidebar fixa como hoje.
- Implementação: novo wrapper client `AppShellClient` (recebe `user` + `children`) que mantém `drawerOpen`, renderiza a top bar + overlay + `Sidebar` (com prop `mobileOpen` e `onNavigate` p/ fechar). `AppShell` (server) passa a renderizar `<AppShellClient>`. CSS via módulo do shell + classes no Sidebar.

### 2. Telas split (`/meu-numero` aba Conversas, `/canal`)
- **Mobile:** painel único. Lista em tela cheia; ao selecionar, painel em tela cheia com **←**. **Desktop:** duas colunas como hoje.
- Novo hook `useIsMobile()` em `apps/web/src/lib/use-is-mobile.ts` — listener de resize, seguro p/ SSR (inicia `false`, atualiza no `useEffect`). Usado para alternar a renderização (lista OU painel no mobile; ambos no desktop) e larguras (coluna fixa 360/380 no desktop → 100% no mobile).

### 3. Demais telas
- Páginas usam estilos inline com `padding: 32px`, `maxWidth` fixo, larguras fixas. No mobile:
  - Reduzir padding (≈16px), `maxWidth` → 100%/`none`.
  - Larguras fixas que estouram → fluidas (`width: 100%`, `maxWidth`).
  - Cards/listas/forms empilham; inputs 100%.
  - Modais (delegação, setor, novo setor): largura = `min(420px, 92vw)`, com margem.
- Onde os estilos forem inline e difíceis de media-query, usar o `useIsMobile()` para escolher valores (ex.: `padding: isMobile ? 16 : 32`).
- Páginas a cobrir: `/dashboard` (Conversas), `/meu-numero`, `/canal`, `/canal/config`, `/configuracoes`, `/configuracoes/setores`, e qualquer outra com largura fixa/overflow.

### 4. Base
- Confirmar `<meta name="viewport" content="width=device-width, initial-scale=1">` (Next injeta por padrão via metadata; confirmar/garantir no `app/layout.tsx`).
- Alvos de toque ~40px; eliminar scroll horizontal (`overflow-x` controlado; sem larguras fixas maiores que a viewport).

## Não-objetivos (YAGNI)
- PWA/instalável, gestos de swipe, orientação landscape específica, redesenho visual. Só responsividade.

## Critério de sucesso
- Em ~375px de largura: menu abre/fecha como gaveta; nenhuma tela com scroll horizontal; splits mostram lista↔painel com voltar; formulários e cards legíveis e tocáveis. Desktop inalterado.

## Verificação
- `tsc --noEmit` limpo.
- Inspeção em viewport mobile (DevTools/responsive) das telas principais após deploy.
- Nenhuma mudança de comportamento/funcionalidade — apenas layout.
