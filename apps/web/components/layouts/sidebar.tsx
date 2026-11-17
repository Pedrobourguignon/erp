"use client";

import {
  ShoppingCart,
  Package,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  LayoutDashboard,
  Users,
  BoxIcon,
  Landmark,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { usePermissions } from "@/hooks/use-permissions";
import { NAV_ITEMS, activeChildHref, filterNavItems, type NavItem } from "@/lib/nav-items";
import { cn } from "@/lib/utils";

// ─── Icons ──────────────────────────────────────────────────────────────

/** Resolves the icon name declared in `lib/nav-items.ts`. */
const NAV_ICONS: Record<string, React.ElementType> = {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Users,
  Landmark,
  Settings,
};

// ─── Sidebar ────────────────────────────────────────────────────────────

interface SidebarProps {
  /** Drawer aberto (só abaixo de `lg`, onde a sidebar não cabe). */
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
}

export function Sidebar({ mobileOpen = false, onMobileOpenChange }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const { can, isLoaded } = usePermissions();

  // AE-27: an item the user cannot open never reaches the menu. While the
  // permissions load the menu stays empty — items appearing and then vanishing
  // reads as a glitch.
  const navItems = useMemo(
    () => (isLoaded ? filterNavItems(NAV_ITEMS, can) : []),
    [can, isLoaded]
  );
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    NAV_ITEMS.forEach((item) => {
      if (item.children && item.href !== "/" && pathname.startsWith(item.href)) {
        initial.add(item.href);
      }
    });
    return initial;
  });

  // AE-07: navegar fecha o drawer — senão o menu cobre a tela recém-aberta.
  React.useEffect(() => {
    onMobileOpenChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // ESC fecha, e o body para de rolar enquanto o drawer está aberto.
  React.useEffect(() => {
    if (!mobileOpen) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onMobileOpenChange?.(false);
      }
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [mobileOpen, onMobileOpenChange]);

  const toggleGroup = (href: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(href)) {
        next.delete(href);
      } else {
        next.add(href);
      }
      return next;
    });
  };

  return (
    <>
      {/* Overlay do drawer — só existe abaixo de `lg` */}
      {mobileOpen ? (
        <button
          type="button"
          aria-label="Fechar menu"
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={() => onMobileOpenChange?.(false)}
        />
      ) : null}

      <aside
        className={cn(
          "grain-texture flex h-screen flex-col bg-sidebar-bg transition-transform duration-300 ease-in-out",
          // Abaixo de `lg` é drawer: fora da tela até ser aberto.
          "fixed inset-y-0 left-0 z-50 w-[264px]",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          // A partir de `lg` volta a ser coluna fixa do layout.
          "lg:relative lg:translate-x-0",
          collapsed ? "lg:w-[72px]" : "lg:w-[264px]"
        )}
      >
      {/* Logo area */}
      <div className="relative z-10 flex h-16 items-center border-b border-white/[0.06] px-4">
        {!collapsed && (
          <Link href="/" className="flex items-center gap-3 group">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent shadow-lg shadow-accent/20 transition-transform duration-200 group-hover:scale-105">
              <span className="text-sm font-bold text-white font-heading">E</span>
            </div>
            <span className="text-[15px] font-bold text-white/90 font-heading tracking-tight">ERP System</span>
          </Link>
        )}
        {collapsed ? <div className="flex w-full justify-center">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent shadow-lg shadow-accent/20">
              <span className="text-sm font-bold text-white font-heading">E</span>
            </div>
          </div> : null}
      </div>

      {/* Navigation */}
      <nav className="relative z-10 flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {navItems.map((item) => (
          <NavItemComponent
            key={item.href}
            item={item}
            pathname={pathname}
            collapsed={collapsed}
            isOpen={openGroups.has(item.href)}
            onToggle={() => toggleGroup(item.href)}
          />
        ))}
      </nav>

      {/* Collapse toggle */}
      <Tooltip content={collapsed ? "Expandir menu" : "Recolher menu"}>
        <Button
          variant="ghost"
          size="icon"
          className="absolute -right-3 top-20 z-20 hidden h-6 w-6 rounded-full border border-border bg-card shadow-soft transition-all duration-200 hover:border-accent hover:bg-accent hover:text-white lg:flex"
          onClick={() => setCollapsed(!collapsed)}
          // Botão só de ícone: sem isto um leitor de tela anuncia "button" e
          // nada mais. O texto do tooltip só existe ao passar o mouse.
          aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
        >
          {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
        </Button>
      </Tooltip>
        
      {/* Bottom */}
      <div className="relative z-10 border-t border-white/[0.06] px-4 py-3">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-accent animate-pulse-glow" />
            <span className="text-[11px] text-sidebar-fg/60">Sistema ativo</span>
          </div>
        )}
        {collapsed ? <div className="flex justify-center">
            <div className="h-2 w-2 rounded-full bg-accent animate-pulse-glow" />
          </div> : null}
      </div>
      </aside>
    </>
  );
}

// ─── Nav item component ─────────────────────────────────────────────────

function NavItemComponent({
  item,
  pathname,
  collapsed,
  isOpen,
  onToggle,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const hasChildren = item.children && item.children.length > 0;
  const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
  const activeChild = activeChildHref(item.children ?? [], pathname);
  const Icon = NAV_ICONS[item.icon] ?? BoxIcon;

  if (hasChildren && !collapsed) {
    return (
      <div>
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all duration-200",
            isActive
              ? "active-bar bg-white/[0.08] text-white"
              : "text-sidebar-fg hover:bg-white/[0.04] hover:text-white/90"
          )}
        >
          <Icon className={cn("h-[18px] w-[18px] shrink-0 transition-colors duration-200", isActive && "text-accent")} />
          <span className="flex-1 truncate text-left">{item.title}</span>
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", isOpen && "rotate-180")} />
        </button>
        {isOpen ? <div className="ml-[30px] mt-0.5 space-y-0.5 border-l border-white/[0.06] pl-3">
            {item.children?.map((child) => {
              const childActive = child.href === activeChild;
              return (
                <Link
                  key={child.href}
                  href={child.href}
                  className={cn(
                    "block rounded-md px-3 py-2 text-[13px] font-medium transition-all duration-200",
                    childActive
                      ? "bg-white/[0.08] text-white"
                      : "text-sidebar-fg/70 hover:bg-white/[0.04] hover:text-white/90"
                  )}
                >
                  {child.title}
                </Link>
              );
            })}
          </div> : null}
      </div>
    );
  }

  return (
    <Link
      href={hasChildren ? item.children![0].href : item.href}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all duration-200",
        isActive
          ? "active-bar bg-white/[0.08] text-white"
          : "text-sidebar-fg hover:bg-white/[0.04] hover:text-white/90",
        collapsed && "justify-center px-2"
      )}
      title={collapsed ? item.title : undefined}
    >
      <Icon className={cn("h-[18px] w-[18px] shrink-0 transition-colors duration-200", isActive && "text-accent")} />
      {!collapsed && <span className="truncate">{item.title}</span>}
    </Link>
  );
}
