"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@radix-ui/react-dropdown-menu";
import { Bell, LogOut, User, Moon, Sun, Menu } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import React from "react";

import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useAuthStore } from "@/stores/auth.store";


interface HeaderProps {
  /** Abre o drawer da sidebar — só aparece abaixo de `lg` (AE-07). */
  onOpenMenu?: () => void;
}

export function Header({ onOpenMenu }: HeaderProps) {
  const { user, logout } = useAuthStore();
  const { theme, setTheme } = useTheme();
  const router = useRouter();

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  return (
    <>
    <header className="relative z-30 flex h-16 items-center justify-between gap-2 border-b border-border/60 bg-card/80 px-4 backdrop-blur-sm transition-colors duration-200 sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {/* AE-07: abaixo de `lg` a sidebar é drawer e precisa deste botão. */}
        <Tooltip content="Abrir menu">
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 lg:hidden"
            onClick={onOpenMenu}
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
        </Tooltip>
      </div>

      <div className="flex items-center gap-1.5">
        <Tooltip content="Alternar tema">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-lg text-muted-foreground  transition-colors duration-200"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            <Sun className="h-[18px] w-[18px] rotate-0 scale-100 transition-all duration-300 dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-[18px] w-[18px] rotate-90 scale-0 transition-all duration-300 dark:rotate-0 dark:scale-100" />
            <span className="sr-only">Alternar tema</span>
          </Button>
        </Tooltip>

        <Tooltip content="Notificações">
          <Button
            variant="ghost"
            size="icon"
            className="relative h-9 w-9 rounded-lg text-muted-foreground transition-colors duration-200"
          >
            <Bell className="h-[18px] w-[18px]" />
            <span className="absolute right-1.5 top-1.5 flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
            </span>
            <span className="sr-only">Notificações</span>
          </Button>
        </Tooltip>

        <div className="ml-2 h-6 w-px bg-border/60" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="ml-1.5 flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted/60 hover:text-primary transition-colors duration-200"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground ring-2 ring-primary/20">
                {user?.name
                  ?.split(" ")
                  .map((n) => n[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase() || "U"}
              </div>
              <span className="hidden text-sm font-medium md:inline-block">
                {user?.name || "Usuário"}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={8}
            className="z-50 animate-slide-down w-56 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-elevated"
          >
            <DropdownMenuLabel className="px-2.5 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Minha Conta
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="my-1 h-px bg-border" />
            <DropdownMenuItem
              className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none transition-colors duration-150 hover:bg-accent/10 "
              onClick={() => router.push("/configuracoes/perfil")}
            >
              <User className="h-4 w-4 text-muted-foreground" />
              Perfil
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-1 h-px bg-border" />
            <DropdownMenuItem
              className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-destructive outline-none transition-colors duration-150 hover:bg-destructive/10"
              onClick={handleLogout}
            >
              <LogOut className="h-4 w-4" />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
    </>
  );
}
