import { LogOut, Menu } from "lucide-react";
import { useLocation } from "react-router-dom";
import { Button } from "./ui/button";
import { ThemeToggle } from "./ThemeToggle";
import { titleForPath } from "./nav";

export function Topbar({ onMenu, onLogout }: { onMenu: () => void; onLogout: () => void }) {
  const { pathname } = useLocation();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur">
      <Button variant="ghost" size="icon" className="md:hidden" onClick={onMenu} aria-label="Open menu">
        <Menu className="size-4" />
      </Button>
      <h1 className="text-lg font-semibold">{titleForPath(pathname)}</h1>
      <div className="flex-1" />
      <ThemeToggle />
      <Button variant="ghost" size="sm" onClick={onLogout}>
        <LogOut className="size-4" />
        <span className="hidden sm:inline">Log out</span>
      </Button>
    </header>
  );
}
