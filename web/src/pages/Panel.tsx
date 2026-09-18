import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Save, RotateCw, KeyRound } from "lucide-react";
import { useMutation, useQuery, useTransport, createConnectQueryKey } from "@connectrpc/connect-query";
import { useQueryClient } from "@tanstack/react-query";
import { getSettings, updateSettings, getConfig, setAdminToken } from "../gen/panel-PanelService_connectquery";
import type { PanelSettings } from "../gen/panel_pb";
import { setToken } from "../api";
import { listenPort } from "../lib/listen";
import { useLoadErrorToast } from "../lib/useLoadErrorToast";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Field } from "../components/ui/field";
import { Alert } from "../components/ui/alert";
import { Skeleton } from "../components/ui/skeleton";
import { RestartCoreButton } from "../components/RestartCoreButton";
import { UpdateCoreButton } from "../components/UpdateCoreButton";
import { AsyncActionButton } from "../components/AsyncActionButton";

type Form = {
  sni: string;
  statsUrl: string;
  pollIntervalSecs: string;
  grpcAddr: string;
  authAddr: string;
  coreService: string;
  coreBin: string;
  coreConfig: string;
  coreDownloadUrl: string;
};

function toForm(s: PanelSettings): Form {
  return {
    sni: s.sni,
    statsUrl: s.statsUrl,
    pollIntervalSecs: String(s.pollIntervalSecs),
    grpcAddr: s.grpcAddr,
    authAddr: s.authAddr,
    coreService: s.coreService,
    coreBin: s.coreBin,
    coreConfig: s.coreConfig,
    coreDownloadUrl: s.coreDownloadUrl,
  };
}

export default function Panel() {
  const queryClient = useQueryClient();
  const transport = useTransport();

  const [form, setForm] = useState<Form | null>(null);
  const [newToken, setNewToken] = useState("");
  const [issuedToken, setIssuedToken] = useState("");
  const [restartPanel, setRestartPanel] = useState(false);

  const settingsQuery = useQuery(getSettings, {});
  const configQuery = useQuery(getConfig, {});
  useLoadErrorToast(settingsQuery.error, "panel-load");

  useEffect(() => {
    if (settingsQuery.data) setForm(toForm(settingsQuery.data));
  }, [settingsQuery.data]);

  const set = (key: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => (f ? { ...f, [key]: e.target.value } : f));

  const saveMutation = useMutation(updateSettings, {
    onSuccess: (s) => {
      const prev = settingsQuery.data;
      if (prev && (prev.grpcAddr !== s.grpcAddr || prev.authAddr !== s.authAddr)) setRestartPanel(true);
      setForm(toForm(s));
      toast.success("Saved.");
      queryClient.invalidateQueries({
        queryKey: createConnectQueryKey({ schema: getSettings, transport, cardinality: "finite" }),
      });
    },
    onError: (err) => toast.error(err.message),
  });

  function save() {
    if (!form) return;
    saveMutation.mutate({
      sni: form.sni.trim(),
      statsUrl: form.statsUrl.trim(),
      pollIntervalSecs: Number(form.pollIntervalSecs) || 0,
      grpcAddr: form.grpcAddr.trim(),
      authAddr: form.authAddr.trim(),
      coreService: form.coreService.trim(),
      coreBin: form.coreBin.trim(),
      coreConfig: form.coreConfig.trim(),
      coreDownloadUrl: form.coreDownloadUrl.trim(),
    });
  }

  const setAdminTokenMutation = useMutation(setAdminToken, {
    onSuccess: (resp) => {
      setToken(resp.token);
      setIssuedToken(resp.token);
      setNewToken("");
    },
  });

  if (!form) return <Skeleton className="h-[420px]" />;

  const saving = saveMutation.isPending;
  const port = listenPort(configQuery.data?.structured?.listen ?? "");
  const linkPreview = `${window.location.hostname}:${port}${form.sni.trim() ? `  sni=${form.sni.trim()}` : ""}`;

  return (
    <div className="flex flex-col gap-6">
      {restartPanel && (
        <Alert>Listener addresses changed. Restart the panel service to apply them.</Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Client links</CardTitle>
          <CardDescription>Applies to links issued from now on.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field id="sni" label="SNI" hint="Any hostname clients present for camouflage. Blank = none.">
            <Input id="sni" value={form.sni} onChange={set("sni")} placeholder="www.bing.com" spellCheck={false} />
          </Field>
          <p className="font-mono text-xs text-muted">{linkPreview}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Hysteria core</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <UpdateCoreButton variant="default" size="sm" />
            <RestartCoreButton variant="secondary" size="sm" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="core_bin" label="Binary">
              <Input id="core_bin" value={form.coreBin} onChange={set("coreBin")} spellCheck={false} />
            </Field>
            <Field id="core_service" label="systemd unit" hint="Match it in the polkit rule.">
              <Input id="core_service" value={form.coreService} onChange={set("coreService")} spellCheck={false} />
            </Field>
            <Field id="core_config" label="config.yaml">
              <Input id="core_config" value={form.coreConfig} onChange={set("coreConfig")} spellCheck={false} />
            </Field>
            <Field id="core_download_url" label="Download URL" hint="Blank = latest release for this architecture.">
              <Input id="core_download_url" value={form.coreDownloadUrl} onChange={set("coreDownloadUrl")} spellCheck={false} />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Advanced</CardTitle>
          <CardDescription>Listener addresses take effect after a panel restart.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field id="stats_url" label="Traffic Stats API">
            <Input id="stats_url" value={form.statsUrl} onChange={set("statsUrl")} spellCheck={false} />
          </Field>
          <Field id="poll_interval" label="Poll interval (s)">
            <Input id="poll_interval" type="number" min={2} value={form.pollIntervalSecs} onChange={set("pollIntervalSecs")} className="max-w-[140px]" />
          </Field>
          <Field id="grpc_addr" label="Panel API listener">
            <Input id="grpc_addr" value={form.grpcAddr} onChange={set("grpcAddr")} spellCheck={false} />
          </Field>
          <Field id="auth_addr" label="Auth listener">
            <Input id="auth_addr" value={form.authAddr} onChange={set("authAddr")} spellCheck={false} />
          </Field>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button onClick={save} disabled={saving}>
          <Save className="size-4" />
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button variant="secondary" onClick={() => settingsQuery.refetch()} disabled={saving}>
          <RotateCw className="size-4" />
          Reload
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Admin token</CardTitle>
          <CardDescription>One token for the panel, vpnctl and the app. Changing it signs out every other session.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field id="admin_token" label="New token">
            <Input
              id="admin_token"
              type="password"
              value={newToken}
              onChange={(e) => setNewToken(e.target.value)}
              placeholder="blank = generate"
              spellCheck={false}
              autoComplete="new-password"
            />
          </Field>
          <div>
            <AsyncActionButton
              action={() => setAdminTokenMutation.mutateAsync({ token: newToken.trim() })}
              successMessage="Token changed."
              renderIcon={() => <KeyRound className="size-4" />}
              busyLabel="Changing…"
              confirm={{
                title: "Change admin token?",
                description: "Every other session and vpnctl must log in again. This browser stays signed in.",
                confirmLabel: "Change token",
              }}
            >
              Change token
            </AsyncActionButton>
          </div>
          {issuedToken && (
            <Alert>
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">New token. Copy it now, it isn't shown again.</span>
                <code className="break-all font-mono text-xs">{issuedToken}</code>
              </div>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
