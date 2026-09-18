import { LayoutDashboard, Users, ServerCog, SlidersHorizontal, type LucideIcon } from "lucide-react";

export type NavItem = { to: string; label: string; icon: LucideIcon };

export const NAV_ITEMS: NavItem[] = [
  { to: "/stats", label: "Dashboard", icon: LayoutDashboard },
  { to: "/users", label: "Users", icon: Users },
  { to: "/server", label: "Server", icon: ServerCog },
  { to: "/panel", label: "Panel", icon: SlidersHorizontal },
];

export function titleForPath(pathname: string): string {
  const match = NAV_ITEMS.find((i) => pathname.startsWith(i.to));
  return match?.label ?? "Better VPN";
}
