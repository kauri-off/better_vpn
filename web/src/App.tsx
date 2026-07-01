import { useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
import { clearToken, getToken } from "./api";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import Login from "./pages/Login";
import Users from "./pages/Users";
import Stats from "./pages/Stats";
import Config from "./pages/Config";
import Settings from "./pages/Settings";

function Shell() {
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  function logout() {
    clearToken();
    navigate("/login");
  }

  return (
    <div className="flex h-full">
      {/* Desktop sidebar */}
      <aside className="hidden md:block">
        <Sidebar />
      </aside>

      {/* Mobile sidebar (drawer) */}
      <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden" />
          <Dialog.Content className="fixed inset-y-0 left-0 z-50 focus:outline-none md:hidden">
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setMobileOpen(true)} onLogout={logout} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
            <Routes>
              <Route path="/stats" element={<Stats />} />
              <Route path="/users" element={<Users />} />
              <Route path="/config" element={<Config />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/stats" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  // localStorage isn't reactive: subscribe to location so App re-renders (and
  // re-reads the token) on every navigation. Without this, the post-login
  // navigate() re-runs the gate below with a stale `authed` snapshot and bounces
  // back to /login until a second submit. (See Login.tsx.)
  useLocation();
  const authed = !!getToken();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/*" element={authed ? <Shell /> : <Navigate to="/login" replace />} />
    </Routes>
  );
}
