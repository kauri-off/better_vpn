// Multi-server store. The server list ({id, name, url}) lives in the
// SQLite-backed KV store; each server's admin token lives in SecureStore
// (Android Keystore) under its own key so removing a server can't orphan
// another's credential. `url` is always the normalized API base (…/api).
import Storage from "expo-sqlite/kv-store";
import * as SecureStore from "expo-secure-store";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface PanelServer {
  id: string;
  name: string;
  url: string; // normalized API base, e.g. http://192.168.1.98/panel/api
}

const SERVERS_KEY = "panel_servers";
const ACTIVE_KEY = "panel_active_server";
const tokenKey = (id: string) => `panel_token_${id}`;

// Mirror of the web panel's `new URL("api", document.baseURI)`: the user
// enters the panel URL they browse to; the API lives at `api` under it.
// Accepts with/without scheme (defaults to http — LAN panels are usually
// plain http) and with/without a trailing `/api`.
export function normalizeApiUrl(input: string): string {
  let s = input.trim();
  if (!s) throw new Error("Server URL is required");
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  const url = new URL(s);
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  if (!url.pathname.endsWith("/api/")) url.pathname += "api/";
  // Connect baseUrl convention: no trailing slash.
  return url.toString().replace(/\/$/, "");
}

export function serverHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

interface ServersState {
  ready: boolean;
  servers: PanelServer[];
  active: PanelServer | null;
  /** Admin token for the active server; null = signed out / token rejected. */
  activeToken: string | null;
  addServer(input: { name: string; url: string; token: string }): Promise<PanelServer>;
  removeServer(id: string): Promise<void>;
  setActive(id: string): Promise<void>;
  /** Store a (new) token for a server, e.g. after login or rotation. */
  setServerToken(id: string, token: string): Promise<void>;
  /** Drop the active server's stored token (used on Unauthenticated). */
  clearActiveToken(): Promise<void>;
}

const Ctx = createContext<ServersState | null>(null);

export function ServersProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [servers, setServers] = useState<PanelServer[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeToken, setActiveToken] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [rawServers, rawActive] = await Promise.all([
          Storage.getItem(SERVERS_KEY),
          Storage.getItem(ACTIVE_KEY),
        ]);
        const list: PanelServer[] = rawServers ? JSON.parse(rawServers) : [];
        setServers(list);
        const act = list.find((s) => s.id === rawActive) ?? null;
        if (act) {
          setActiveId(act.id);
          setActiveToken(await SecureStore.getItemAsync(tokenKey(act.id)));
        }
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const persistServers = useCallback(async (list: PanelServer[]) => {
    setServers(list);
    await Storage.setItem(SERVERS_KEY, JSON.stringify(list));
  }, []);

  const setActive = useCallback(
    async (id: string) => {
      const token = await SecureStore.getItemAsync(tokenKey(id));
      setActiveId(id);
      setActiveToken(token);
      await Storage.setItem(ACTIVE_KEY, id);
    },
    [],
  );

  const addServer = useCallback(
    async ({ name, url, token }: { name: string; url: string; token: string }) => {
      const normalized = normalizeApiUrl(url);
      const server: PanelServer = {
        id: `s${Date.now().toString(36)}`,
        name: name.trim() || serverHost(normalized),
        url: normalized,
      };
      await SecureStore.setItemAsync(tokenKey(server.id), token);
      await persistServers([...servers, server]);
      setActiveId(server.id);
      setActiveToken(token);
      await Storage.setItem(ACTIVE_KEY, server.id);
      return server;
    },
    [servers, persistServers],
  );

  const removeServer = useCallback(
    async (id: string) => {
      await SecureStore.deleteItemAsync(tokenKey(id));
      await persistServers(servers.filter((s) => s.id !== id));
      if (activeId === id) {
        setActiveId(null);
        setActiveToken(null);
        await Storage.removeItem(ACTIVE_KEY);
      }
    },
    [servers, activeId, persistServers],
  );

  const setServerToken = useCallback(
    async (id: string, token: string) => {
      await SecureStore.setItemAsync(tokenKey(id), token);
      if (id === activeId) setActiveToken(token);
    },
    [activeId],
  );

  const clearActiveToken = useCallback(async () => {
    if (!activeId) return;
    await SecureStore.deleteItemAsync(tokenKey(activeId));
    setActiveToken(null);
  }, [activeId]);

  const value = useMemo<ServersState>(
    () => ({
      ready,
      servers,
      active: servers.find((s) => s.id === activeId) ?? null,
      activeToken,
      addServer,
      removeServer,
      setActive,
      setServerToken,
      clearActiveToken,
    }),
    [ready, servers, activeId, activeToken, addServer, removeServer, setActive, setServerToken, clearActiveToken],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useServers(): ServersState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useServers must be used within ServersProvider");
  return ctx;
}
