import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TransportProvider } from "@connectrpc/connect-query";
import App from "./App";
import { transport } from "./api";
import { ThemeProvider } from "./components/ThemeProvider";
import { ThemedToaster } from "./components/ThemeToggle";
import "./index.css";

// Share the existing gRPC-Web transport (auth interceptor + Caddy-subpath base
// URL) with connect-query's hooks, and give TanStack Query a single client.
const queryClient = new QueryClient();

// HashRouter keeps all routing client-side under whatever subpath Caddy serves,
// so no server rewrite rules are needed.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <TransportProvider transport={transport}>
        <QueryClientProvider client={queryClient}>
          <HashRouter>
            <App />
          </HashRouter>
        </QueryClientProvider>
      </TransportProvider>
      <ThemedToaster />
    </ThemeProvider>
  </React.StrictMode>,
);
