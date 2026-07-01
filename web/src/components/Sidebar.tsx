import { NavLink } from "react-router-dom";
import { cn } from "../lib/utils";
import { Logo } from "./Logo";
import { NAV_ITEMS } from "./nav";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full w-60 flex-col gap-1 border-r border-border bg-card p-3">
      <div className="flex items-center gap-2 px-2 py-3">
        <Logo className="size-8" />
        <span className="text-base font-semibold">Better VPN</span>
      </div>
      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-[var(--radius)] px-3 py-2 text-sm font-medium transition-colors",
                isActive ? "bg-primary text-primary-foreground" : "text-muted hover:bg-muted-bg hover:text-foreground",
              )
            }
          >
            <Icon className="size-4" />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
