import { useEffect, useState } from "react";
import { AppState } from "react-native";

// True while the app is foregrounded. Used to pause live polling in the
// background so the panel isn't hammered from a pocketed phone.
export function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setActive(s === "active"));
    return () => sub.remove();
  }, []);
  return active;
}
