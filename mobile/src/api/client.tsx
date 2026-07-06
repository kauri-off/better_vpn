// gRPC-Web transport for the active panel server, plus the provider wiring
// for connect-query hooks. Mirrors web/src/api.ts, adapted for React Native:
// fetch comes from expo/fetch — RN's built-in fetch can only stream text and
// corrupts the binary gRPC-Web frames ("missing trailer"), while expo/fetch
// streams bytes. A rejected bearer token routes back to the server list
// instead of reloading the page.
import "@/polyfills";

import type { DescMessage, DescMethodUnary } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient, type Client, type Interceptor } from "@connectrpc/connect";
import { createGrpcWebTransport } from "@connectrpc/connect-web";
import { createConnectQueryKey, TransportProvider } from "@connectrpc/connect-query";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fetch as expoFetch } from "expo/fetch";
import { useEffect, useMemo, type ReactNode } from "react";
import { AppState } from "react-native";

import { PanelService } from "@/gen/panel_pb";
import { useServers } from "@/api/servers";

// Tell TanStack Query when the app is foregrounded: refetchInterval pauses in
// the background and active queries refetch on return (both are react-query
// defaults once focus is wired), so screens don't need their own AppState hook.
focusManager.setEventListener((handleFocus) => {
  const sub = AppState.addEventListener("change", (s) => handleFocus(s === "active"));
  return () => sub.remove();
});

// UI polling cadence for live data (dashboard, users list). The backend's
// stats poller refreshes on a >=2s tick, so 3s keeps the UI at most one tick
// stale — same value as the web panel.
export const POLL_MS = 3000;

/**
 * Invalidate the cached queries of specific RPCs (all inputs), instead of
 * nuking the whole cache after every mutation.
 */
export function invalidateRpcQueries(
  queryClient: QueryClient,
  schemas: DescMethodUnary<DescMessage, DescMessage>[],
) {
  for (const schema of schemas) {
    queryClient.invalidateQueries({
      queryKey: createConnectQueryKey({ schema, cardinality: undefined }),
    });
  }
}

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
// Latest credentials for the auth interceptor, read lazily at request time so
// a token rotation doesn't tear down in-flight requests created against the
// old transport instance. Module scope rather than refs: the provider mounts
// exactly once, and the React Compiler forbids touching refs from
// render-scoped closures (the useMemo below).
let currentToken: string | null = null;
let onUnauthenticatedNow: () => void = () => {};

export function PanelConnectProvider({ children }: { children: ReactNode }) {
  const { active, activeToken, clearActiveToken } = useServers();

  useEffect(() => {
    currentToken = activeToken;
    onUnauthenticatedNow = clearActiveToken;
  }, [activeToken, clearActiveToken]);

  const queryClient = useMemo(() => new QueryClient(), []);

  const transport = useMemo(
    () =>
      createPanelTransport({
        // A dummy URL keeps the provider tree stable while signed out; the
        // auth gate never renders query-issuing screens in that state.
        url: active?.url ?? "http://unconfigured.invalid",
        getToken: () => currentToken,
        onUnauthenticated: () => onUnauthenticatedNow(),
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
