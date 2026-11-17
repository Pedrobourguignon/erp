import type { PermissionName } from "@erp/constants";

/**
 * Navigation config for the sidebar, with the permission each entry requires.
 *
 * AE-27/FN-09: the menu used to be a static list, so a seller saw Financeiro
 * and Configurações, clicked in and got a wall of 403s rendered as empty
 * tables. The permission lives next to the route here so a new screen cannot be
 * added without deciding who sees it.
 *
 * The filter is **cosmetic** — `RequirePermission` on the page is the real
 * guard, because an unlisted route is still reachable by URL.
 */

export interface NavChild {
  title: string;
  href: string;
  permission?: PermissionName;
}

export interface NavItem {
  title: string;
  href: string;
  /** Icon name resolved by the sidebar — keeps this module free of JSX. */
  icon: string;
  permission?: PermissionName;
  children?: NavChild[];
}

export const NAV_ITEMS: NavItem[] = [
  {
    title: "Dashboard",
    href: "/",
    icon: "LayoutDashboard",
  },
  {
    title: "Estoque",
    href: "/estoque",
    icon: "Package",
    children: [
      { title: "Produtos", href: "/estoque/produtos", permission: "products:read" },
      { title: "Categorias", href: "/estoque/categorias", permission: "products:read" },
      { title: "Marcas", href: "/estoque/marcas", permission: "products:read" },
      { title: "Movimentações", href: "/estoque/movimentacoes", permission: "inventory:read" },
      { title: "Depósitos", href: "/estoque/depositos", permission: "inventory:read" },
      { title: "Alertas", href: "/estoque/alertas", permission: "inventory:read" },
    ],
  },
  {
    title: "Vendas",
    href: "/vendas",
    icon: "ShoppingCart",
    children: [
      { title: "Pedidos", href: "/vendas/pedidos", permission: "orders:read" },
      { title: "Nova Venda", href: "/vendas/pedidos/novo", permission: "orders:create" },
      { title: "Venda Balcão", href: "/vendas/balcao", permission: "orders:create" },
    ],
  },
  {
    title: "Clientes",
    href: "/clientes",
    icon: "Users",
    permission: "customers:read",
  },
  {
    title: "Financeiro",
    href: "/financeiro",
    icon: "Landmark",
    permission: "financial:read",
    children: [
      { title: "Contas", href: "/financeiro/contas", permission: "financial:read" },
      { title: "Despesas e Receitas", href: "/financeiro/lancamentos", permission: "financial:read" },
      { title: "Caixas", href: "/financeiro/caixa", permission: "financial:read" },
    ],
  },
  {
    title: "Configurações",
    href: "/configuracoes",
    icon: "Settings",
    children: [
      { title: "Geral", href: "/configuracoes", permission: "settings:read" },
      {
        title: "Métodos Pagamento",
        href: "/configuracoes/metodos-pagamento",
        permission: "financial:create",
      },
      {
        title: "Maquininhas",
        href: "/configuracoes/maquininhas",
        permission: "financial:read",
      },
    ],
  },
];

/**
 * Keeps only the entries the user may reach.
 *
 * A group whose children all disappeared disappears too — an "Estoque" heading
 * that opens into nothing is just a dead end.
 */
export function filterNavItems(
  items: NavItem[],
  can: (permission: PermissionName) => boolean
): NavItem[] {
  return items.flatMap((item) => {
    if (item.permission && !can(item.permission)) {
      return [];
    }

    if (!item.children) {
      return [item];
    }

    const children = item.children.filter(
      (child) => !child.permission || can(child.permission)
    );
    if (children.length === 0) {
      return [];
    }

    return [{ ...item, children }];
  });
}

/**
 * The one child the current page belongs to: the most specific href that is
 * the page itself or a parent of it. `startsWith` alone marked "Pedidos" on
 * "/vendas/pedidos/novo" (Nova Venda) and "Geral" on every settings screen.
 */
export function activeChildHref(
  children: ReadonlyArray<Pick<NavChild, "href">>,
  pathname: string
): string | null {
  const matches = children
    .map((child) => child.href)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`));
  if (matches.length === 0) {return null;}
  return matches.reduce((best, href) => (href.length > best.length ? href : best));
}
