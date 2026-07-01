import { LayoutDashboard, Users, FileCog, Settings, type LucideIcon } from "lucide-react";

export type NavItem = { to: string; label: string; icon: LucideIcon };

export const NAV_ITEMS: NavItem[] = [
  { to: "/stats", label: "Dashboard", icon: LayoutDashboard },
  { to: "/users", label: "Users", icon: Users },
  { to: "/config", label: "Config", icon: FileCog },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function titleForPath(pathname: string): string {
  const match = NAV_ITEMS.find((i) => pathname.startsWith(i.to));
  return match?.label ?? "Better VPN";
}
