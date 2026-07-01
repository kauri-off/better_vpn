import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@connectrpc/connect-query";
import { login } from "../gen/panel-PanelService_connectquery";
import { setToken } from "../api";
import { Logo } from "../components/Logo";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Alert } from "../components/ui/alert";
import { Spinner } from "../components/ui/spinner";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();

  const loginMutation = useMutation(login, {
    onSuccess: (resp) => {
      setToken(resp.token);
      navigate("/stats");
    },
  });
  const busy = loginMutation.isPending;
  const error = loginMutation.error?.message ?? "";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    loginMutation.mutate({ username, password });
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
              <Label htmlFor="username">Username</Label>
              <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && <Alert>{error}</Alert>}
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
