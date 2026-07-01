import { Moon, Sun } from "lucide-react";
import { Toaster } from "sonner";
import { Button } from "./ui/button";
import { useTheme } from "./ThemeProvider";

/** Sonner toaster bound to the app theme (not the OS preference). */
export function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster position="top-right" theme={theme} richColors closeButton />;
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme" title="Toggle theme">
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
