import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dices, RotateCw, Save } from "lucide-react";
import { useMutation, useQuery, useTransport, createConnectQueryKey } from "@connectrpc/connect-query";
import { useQueryClient } from "@tanstack/react-query";
import { getConfig, updateConfig, updateRawConfig } from "../gen/panel-PanelService_connectquery";
import type { ConfigResponse, HysteriaConfig } from "../gen/panel_pb";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Textarea } from "../components/ui/textarea";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { Alert } from "../components/ui/alert";
import { Skeleton } from "../components/ui/skeleton";
import { RestartCoreButton } from "../components/RestartCoreButton";

/** A URL-safe random secret (32 base64url chars) for the obfs password. */
function generateSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export default function Config() {
  const queryClient = useQueryClient();
  const transport = useTransport();

  // Full structured view as loaded — the source of truth for fields the form
  // does not edit (listen/tls), which must round-trip untouched because
  // UpdateConfig rewrites every managed key from the submitted object.
  const [structured, setStructured] = useState<HysteriaConfig | undefined>();
  const [raw, setRaw] = useState("");

  // Editable structured fields.
  const [obfsEnabled, setObfsEnabled] = useState(false);
  const [obfsPassword, setObfsPassword] = useState("");
  const [bwUp, setBwUp] = useState("");
  const [bwDown, setBwDown] = useState("");
  const [masqType, setMasqType] = useState("");
  const [masqProxyUrl, setMasqProxyUrl] = useState("");
  const [masqStringContent, setMasqStringContent] = useState("");

  function hydrate(c: ConfigResponse) {
    setRaw(c.rawYaml);
    setStructured(c.structured);
    const s = c.structured;
    setObfsEnabled(s?.obfs?.type?.toLowerCase() === "salamander");
    setObfsPassword(s?.obfs?.password ?? "");
    setBwUp(s?.bandwidth?.up ?? "");
    setBwDown(s?.bandwidth?.down ?? "");
    setMasqType(s?.masquerade?.type ?? "");
    setMasqProxyUrl(s?.masquerade?.proxyUrl ?? "");
    setMasqStringContent(s?.masquerade?.stringContent ?? "");
  }

  const { data, isLoading: loading, error, refetch } = useQuery(getConfig, {});

  // Seed the editable form from the fetched config (and on every reload).
  useEffect(() => {
    if (data) hydrate(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Load failures surface as a toast (stable id so refetch retries don't stack).
  useEffect(() => {
    if (error) toast.error(error.message, { id: "config-load" });
  }, [error]);

  function savedToast(c: ConfigResponse) {
    toast.success(
      c.managedBlocksReasserted
        ? "Saved. Managed auth/trafficStats blocks reasserted."
        : "Saved.",
    );
  }

  function invalidateConfig() {
    queryClient.invalidateQueries({
      queryKey: createConnectQueryKey({ schema: getConfig, transport, cardinality: "finite" }),
    });
  }

  const updateConfigMutation = useMutation(updateConfig, {
    onSuccess: (c) => {
      hydrate(c);
      savedToast(c);
      invalidateConfig();
    },
    onError: (err) => toast.error(err.message),
  });
  const updateRawMutation = useMutation(updateRawConfig, {
    onSuccess: (c) => {
      hydrate(c);
      savedToast(c);
      invalidateConfig();
    },
    onError: (err) => toast.error(err.message),
  });
  const saving = updateConfigMutation.isPending;
  const savingRaw = updateRawMutation.isPending;

  function saveStructured() {
    // Carry listen/tls through unchanged (they're owned by the Settings cert
    // flow / raw editor); overwrite only the fields this form owns.
    updateConfigMutation.mutate({
      structured: {
        listen: structured?.listen ?? "",
        tls: structured?.tls,
        obfs: {
          type: obfsEnabled ? "salamander" : "",
          password: obfsEnabled ? obfsPassword : "",
        },
        bandwidth: { up: bwUp.trim(), down: bwDown.trim() },
        masquerade: {
          type: masqType,
          proxyUrl: masqType === "proxy" ? masqProxyUrl.trim() : "",
          stringContent: masqType === "string" ? masqStringContent : "",
        },
      },
    });
  }

  function saveRaw() {
    updateRawMutation.mutate({ rawYaml: raw });
  }

  const restartHint = (
    <Alert>
      <div className="flex flex-col items-start gap-2">
        <span>Restart the core to apply changes.</span>
        <RestartCoreButton variant="secondary" size="sm" />
      </div>
    </Alert>
  );

  return (
    <div className="flex flex-col gap-6">
      {loading ? (
        <Skeleton className="h-[420px]" />
      ) : (
        <>
          {/* ---- Obfuscation ---- */}
          <Card>
            <CardHeader>
              <CardTitle>Obfuscation</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <Switch id="obfs" checked={obfsEnabled} onCheckedChange={setObfsEnabled} />
                <Label htmlFor="obfs" className="cursor-pointer">
                  Enable
                </Label>
              </div>
              {obfsEnabled && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="obfs_password">Obfuscation password</Label>
                  <div className="flex gap-2">
                    <Input
                      id="obfs_password"
                      value={obfsPassword}
                      onChange={(e) => setObfsPassword(e.target.value)}
                      placeholder="shared secret"
                      spellCheck={false}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setObfsPassword(generateSecret())}
                    >
                      <Dices className="size-4" />
                      Generate
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ---- Bandwidth ---- */}
          <Card>
            <CardHeader>
              <CardTitle>Bandwidth</CardTitle>
              <p className="text-sm text-muted">
                Per-connection rate caps advertised to clients. Leave blank to use Hysteria's
                congestion control with no fixed cap.
              </p>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bw_up">Up</Label>
                <Input
                  id="bw_up"
                  value={bwUp}
                  onChange={(e) => setBwUp(e.target.value)}
                  placeholder="100 mbps"
                  spellCheck={false}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bw_down">Down</Label>
                <Input
                  id="bw_down"
                  value={bwDown}
                  onChange={(e) => setBwDown(e.target.value)}
                  placeholder="100 mbps"
                  spellCheck={false}
                />
              </div>
            </CardContent>
          </Card>

          {/* ---- Masquerade ---- */}
          <Card>
            <CardHeader>
              <CardTitle>Masquerade</CardTitle>
              <p className="text-sm text-muted">
                How the server replies to probes that aren't valid Hysteria traffic, so it looks like
                an ordinary web server.
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="masq_type">Type</Label>
                <select
                  id="masq_type"
                  value={masqType}
                  onChange={(e) => setMasqType(e.target.value)}
                  className="flex h-9 w-full rounded-[var(--radius)] border border-border bg-input px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:max-w-[240px]"
                >
                  <option value="">Off</option>
                  <option value="proxy">Reverse proxy</option>
                  <option value="string">Fixed string</option>
                  <option value="file">Static files (path in raw YAML)</option>
                </select>
              </div>
              {masqType === "proxy" && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="masq_proxy">Upstream URL</Label>
                  <Input
                    id="masq_proxy"
                    value={masqProxyUrl}
                    onChange={(e) => setMasqProxyUrl(e.target.value)}
                    placeholder="https://news.ycombinator.com/"
                    spellCheck={false}
                  />
                </div>
              )}
              {masqType === "string" && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="masq_string">Response body</Label>
                  <Textarea
                    id="masq_string"
                    value={masqStringContent}
                    onChange={(e) => setMasqStringContent(e.target.value)}
                    spellCheck={false}
                    className="min-h-[100px] font-mono text-xs"
                  />
                </div>
              )}
              {masqType === "file" && (
                <p className="text-xs text-muted">
                  The file directory lives under <code className="rounded bg-muted-bg px-1 py-0.5">masquerade.file</code> — edit it in the
                  advanced raw YAML below.
                </p>
              )}
            </CardContent>
          </Card>

          {restartHint}

          <div className="flex gap-2">
            <Button onClick={saveStructured} disabled={saving}>
              <Save className="size-4" />
              {saving ? "Saving…" : "Save config"}
            </Button>
            <Button variant="secondary" onClick={() => refetch()} disabled={saving}>
              <RotateCw className="size-4" />
              Reload
            </Button>
          </div>

          {/* ---- Advanced: raw YAML ---- */}
          <Card>
            <CardContent className="pt-6">
              <details>
                <summary className="cursor-pointer text-sm font-medium">
                  Advanced — edit raw YAML
                </summary>
                <div className="mt-4 flex flex-col gap-3">
                  <p className="text-sm text-muted">
                    The full <code className="rounded bg-muted-bg px-1 py-0.5 text-xs">config.yaml</code>{" "}
                    on disk, for fields the form above doesn't cover (TLS/cert via the Settings page,
                    resolver, ACL, etc.). Unknown keys are preserved; the managed{" "}
                    <code className="rounded bg-muted-bg px-1 py-0.5 text-xs">auth</code> and{" "}
                    <code className="rounded bg-muted-bg px-1 py-0.5 text-xs">trafficStats</code> blocks
                    are reasserted on save.
                  </p>
                  <Textarea
                    value={raw}
                    onChange={(e) => setRaw(e.target.value)}
                    spellCheck={false}
                    className="min-h-[360px] font-mono text-xs leading-relaxed"
                  />
                  <div className="flex gap-2">
                    <Button onClick={saveRaw} disabled={savingRaw}>
                      <Save className="size-4" />
                      {savingRaw ? "Saving…" : "Save raw YAML"}
                    </Button>
                    <Button variant="secondary" onClick={() => refetch()} disabled={savingRaw}>
                      <RotateCw className="size-4" />
                      Reload
                    </Button>
                  </div>
                </div>
              </details>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
