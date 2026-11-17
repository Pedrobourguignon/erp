"use client";

import { Building2, Users, CreditCard, Receipt } from "lucide-react";
import React, { useState } from "react";

import { RequirePermission } from "@/components/auth/require-permission";
import { cn } from "@/lib/utils";

import { CompanyTab } from "./_components/company-tab";
import { PlanTab } from "./_components/plan-tab";
import { ReceiptSettingsTab } from "./_components/receipt-settings-tab";
import { UsersTab } from "./_components/users-tab";

// ─── Tabs ───────────────────────────────────────────────────────────────

const tabs = [
  { id: "empresa", label: "Empresa", icon: Building2 },
  { id: "recibo", label: "Recibo", icon: Receipt },
  { id: "usuarios", label: "Usuários", icon: Users },
  { id: "plano", label: "Plano", icon: CreditCard },
] as const;

type TabId = (typeof tabs)[number]["id"];

// ─── Page ───────────────────────────────────────────────────────────────

function SettingsPageContent() {
  const [activeTab, setActiveTab] = useState<TabId>("empresa");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Configurações</h1>
        <p className="text-muted-foreground">Gerencie as configurações da sua conta</p>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground"
            )}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "empresa" && <CompanyTab />}
      {activeTab === "recibo" && <ReceiptSettingsTab />}
      {activeTab === "usuarios" && <UsersTab />}
      {activeTab === "plano" && <PlanTab />}
    </div>
  );
}

// AE-27/FN-09: the menu hides this route, but a URL still reaches it — the
// page guard is the real one.
export default function SettingsPage() {
  return (
    <RequirePermission permission="settings:read" subject="as configurações">
      <SettingsPageContent />
    </RequirePermission>
  );
}
