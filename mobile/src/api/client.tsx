// gRPC-Web transport for the active panel server, plus the provider wiring
// for connect-query hooks. Mirrors web/src/api.ts, adapted for React Native:
// fetch comes from expo/fetch — RN's built-in fetch can only stream text and
// corrupts the binary gRPC-Web frames ("missing trailer"), while expo/fetch
// streams bytes. A rejected bearer token routes back to the server list
// instead of reloading the page.
import "@/polyfills";

import { Code, ConnectError, createClient, type Client, type Interceptor } from "@connectrpc/connect";
import { createGrpcWebTransport } from "@connectrpc/connect-web";
import { TransportProvider } from "@connectrpc/connect-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fetch as expoFetch } from "expo/fetch";
import { useEffect, useMemo, useRef, type ReactNode } from "react";

import { PanelService } from "@/gen/panel_pb";
import { useServers } from "@/api/servers";

// UI polling cadence for live data (dashboard, users list). The backend's
// stats poller refreshes on a >=2s tick, so 3s keeps the UI at most one tick
// stale — same value as the web panel.
export const POLL_MS = 3000;

// expo/fetch is WinterCG-compliant but typed slightly differently from DOM
// fetch; the shapes Connect touches (Headers, body stream, arrayBuffer) match.
const streamingFetch = expoFetch as unknown as typeof globalThis.fetch;

export interface PanelTransportOptions {
  url: string;
  getToken: () => string | null;
  /** Called when the server rejects a stored token (Unauthenticated). */
  onUnauthenticated?: () => void;
}

export function createPanelTransport({ url, getToken, onUnauthenticated }: PanelTransportOptions) {
  const auth: Interceptor = (next) => async (req) => {
    const token = getToken();
    if (token) req.header.set("authorization", `Bearer ${token}`);
    try {
      return await next(req);
    } catch (err) {
      // Guard on `token` so a failed Login (no stored token yet) surfaces its
      // own error inline instead of bouncing to the server list.
      if (token && err instanceof ConnectError && err.code === Code.Unauthenticated) {
        onUnauthenticated?.();
      }
      throw err;
    }
  };
  return createGrpcWebTransport({ baseUrl: url, interceptors: [auth], fetch: streamingFetch });
}

/** One-off unauthenticated client for validating a server URL + token (Login). */
export function probeClient(url: string): Client<typeof PanelService> {
  return createClient(PanelService, createGrpcWebTransport({ baseUrl: url, fetch: streamingFetch }));
}

/**
 * Provides the connect-query transport + react-query client for the active
 * server. Remounts queries with a cleared cache whenever the active server
 * changes so no data leaks between panels.
 */
export function PanelConnectProvider({ children }: { children: ReactNode }) {
  const { active, activeToken, clearActiveToken } = useServers();

  // The interceptor reads through refs so a token rotation doesn't have to
  // tear down in-flight requests created against the old transport instance.
  const tokenRef = useRef(activeToken);
  tokenRef.current = activeToken;
  const clearRef = useRef(clearActiveToken);
  clearRef.current = clearActiveToken;

  const queryClient = useMemo(() => new QueryClient(), []);

  const transport = useMemo(
    () =>
      createPanelTransport({
        // A dummy URL keeps the provider tree stable while signed out; the
        // auth gate never renders query-issuing screens in that state.
        url: active?.url ?? "http://unconfigured.invalid",
        getToken: () => tokenRef.current,
        onUnauthenticated: () => void clearRef.current(),
      }),
    [active?.url],
  );

  useEffect(() => {
    queryClient.clear();
  }, [queryClient, active?.id]);

  return (
    <TransportProvider transport={transport}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </TransportProvider>
  );
}
