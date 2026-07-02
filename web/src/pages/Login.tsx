import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useMutation } from "@connectrpc/connect-query";
import { login } from "../gen/panel-PanelService_connectquery";
import { setToken } from "../api";
import { Logo } from "../components/Logo";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Spinner } from "../components/ui/spinner";

export default function Login() {
  const [token, setTokenInput] = useState("");
  const navigate = useNavigate();

  const loginMutation = useMutation(login, {
    onSuccess: () => {
      // The token itself is the bearer credential (no session token is issued),
      // so store exactly what we just verified.
      setToken(token.trim());
      navigate("/stats");
    },
    onError: (err) => toast.error(err.message, { id: "login" }),
  });
  const busy = loginMutation.isPending;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    loginMutation.mutate({ token: token.trim() });
  }

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <Logo className="mx-auto size-12" />
          <CardTitle className="mt-2 text-xl">Better VPN</CardTitle>
          <p className="text-sm text-muted">Sign in to the admin panel</p>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="token">Access token</Label>
              <Input
                id="token"
                type="password"
                value={token}
                onChange={(e) => setTokenInput(e.target.value)}
                autoFocus
                spellCheck={false}
              />
            </div>
            <Button type="submit" disabled={busy} className="mt-1">
              {busy && <Spinner />}
              {busy ? "Signing in…" : "Log in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
