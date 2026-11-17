import { getRolePermissions, type PermissionName } from '@erp/constants';
import { describe, it, expect } from 'vitest';

import { NAV_ITEMS, activeChildHref, filterNavItems } from './nav-items';

/**
 * AE-27/FN-09: the sidebar showed every module to every role. These tests run
 * the real role matrix from `@erp/constants` through the filter, so the menu a
 * seller sees is asserted against the permissions the seed actually grants —
 * not against a hand-written list that can drift from it.
 */

function menuFor(roleName: string) {
  const granted: string[] = getRolePermissions(roleName);
  const can = (permission: PermissionName) => granted.includes(permission);
  const items = filterNavItems(NAV_ITEMS, can);
  return {
    groups: items.map((item) => item.title),
    hrefs: items.flatMap((item) =>
      item.children ? item.children.map((child) => child.href) : [item.href]
    ),
  };
}

const ownerMenu = { can: () => true };

describe('filterNavItems', () => {
  it('shows everything to owner', () => {
    const items = filterNavItems(NAV_ITEMS, ownerMenu.can);

    expect(items).toHaveLength(NAV_ITEMS.length);
    expect(items.map((i) => i.title)).toContain('Financeiro');
    expect(items.map((i) => i.title)).toContain('Configurações');
  });

  it('drops a group whose children are all gated away', () => {
    const items = filterNavItems(NAV_ITEMS, () => false);

    // Only the Dashboard survives — it is the one entry with no permission.
    expect(items.map((i) => i.title)).toEqual(['Dashboard']);
  });

  it('keeps a group when at least one child survives', () => {
    const can = (p: PermissionName) => p === 'products:read';
    const estoque = filterNavItems(NAV_ITEMS, can).find((i) => i.title === 'Estoque');

    expect(estoque?.children?.map((c) => c.title)).toEqual([
      'Produtos',
      'Categorias',
      'Marcas',
    ]);
  });

  it('does not mutate the shared config while filtering', () => {
    const estoqueBefore = NAV_ITEMS.find((i) => i.title === 'Estoque')?.children?.length;

    filterNavItems(NAV_ITEMS, () => false);

    expect(NAV_ITEMS.find((i) => i.title === 'Estoque')?.children?.length).toBe(
      estoqueBefore
    );
  });
});

describe('menu per role', () => {
  describe('seller', () => {
    const { groups, hrefs } = menuFor('seller');

    it('does not show Financeiro or Configurações (AE-27)', () => {
      expect(groups).not.toContain('Financeiro');
      expect(groups).not.toContain('Configurações');
    });

    it('shows what a seller works with', () => {
      expect(groups).toEqual(['Dashboard', 'Estoque', 'Vendas', 'Clientes']);
      expect(hrefs).toContain('/vendas/balcao');
      expect(hrefs).toContain('/vendas/pedidos');
      expect(hrefs).toContain('/clientes');
      expect(hrefs).toContain('/estoque/produtos');
    });

    it('hides the inventory admin screens the QA flagged', () => {
      expect(hrefs).not.toContain('/estoque/movimentacoes');
      expect(hrefs).not.toContain('/estoque/depositos');
      expect(hrefs).not.toContain('/estoque/alertas');
    });
  });

  describe('financial', () => {
    const { groups, hrefs } = menuFor('financial');

    it('shows the financial module', () => {
      expect(groups).toContain('Financeiro');
      expect(hrefs).toContain('/financeiro/caixa');
    });

    it('still reaches the payment configuration screens', () => {
      expect(hrefs).toContain('/configuracoes/metodos-pagamento');
      expect(hrefs).toContain('/configuracoes/maquininhas');
      // As parcelas são escolhidas na venda, até o máximo do método.
      expect(hrefs).not.toContain('/configuracoes/condicoes-pagamento');
    });

    it('does not offer to create an order', () => {
      expect(hrefs).not.toContain('/vendas/balcao');
    });
  });

  describe('warehouse', () => {
    const { groups, hrefs } = menuFor('warehouse');

    it('sees stock, not money', () => {
      expect(hrefs).toContain('/estoque/movimentacoes');
      expect(groups).not.toContain('Financeiro');
    });
  });

  describe('viewer', () => {
    const { hrefs } = menuFor('viewer');

    it('can look at the financial module but not create a sale', () => {
      expect(hrefs).toContain('/financeiro/contas');
      expect(hrefs).not.toContain('/vendas/balcao');
      expect(hrefs).not.toContain('/configuracoes/metodos-pagamento');
    });
  });
});

// "Nova Venda" (/vendas/pedidos/novo) também acendia "Pedidos", e qualquer
// tela de configuração acendia "Geral" (/configuracoes): bastava o endereço
// começar com o link. Só o submenu mais específico fica marcado.
describe('activeChildHref', () => {
  const children = (group: string) =>
    NAV_ITEMS.find((item) => item.title === group)?.children ?? [];

  it.each([
    ['Vendas', '/vendas/pedidos/novo', '/vendas/pedidos/novo'],
    ['Vendas', '/vendas/pedidos', '/vendas/pedidos'],
    ['Vendas', '/vendas/pedidos/abc123', '/vendas/pedidos'],
    ['Vendas', '/vendas/balcao', '/vendas/balcao'],
    ['Configurações', '/configuracoes/maquininhas', '/configuracoes/maquininhas'],
    ['Configurações', '/configuracoes', '/configuracoes'],
  ])('%s at %s marks only %s', (group, pathname, expected) => {
    expect(activeChildHref(children(group), pathname)).toBe(expected);
  });

  it('marks nothing when no child matches', () => {
    expect(activeChildHref(children('Vendas'), '/clientes')).toBeNull();
  });

  it('does not match a sibling that only shares a prefix', () => {
    expect(activeChildHref([{ title: 'A', href: '/vendas/pedidos' }], '/vendas/pedidos-antigos')).toBeNull();
  });
});
