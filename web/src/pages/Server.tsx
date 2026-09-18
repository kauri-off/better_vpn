import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dices, RotateCw, Save, ShieldPlus } from "lucide-react";
import { useMutation, useQuery, useTransport, createConnectQueryKey } from "@connectrpc/connect-query";
import { useQueryClient } from "@tanstack/react-query";
import { getConfig, updateConfig, updateRawConfig, getCertInfo, generateCert } from "../gen/panel-PanelService_connectquery";
import type { ConfigResponse, HysteriaConfig } from "../gen/panel_pb";
import { fmtTs } from "../api";
import { listenPort, setListenPort } from "../lib/listen";
import { useLoadErrorToast } from "../lib/useLoadErrorToast";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Textarea } from "../components/ui/textarea";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select } from "../components/ui/select";
import { Field } from "../components/ui/field";
import { Switch } from "../components/ui/switch";
import { Badge } from "../components/ui/badge";
import { Skeleton } from "../components/ui/skeleton";
import { RestartCoreButton } from "../components/RestartCoreButton";
import { AsyncActionButton } from "../components/AsyncActionButton";

function generateSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export default function Server() {
  const queryClient = useQueryClient();
  const transport = useTransport();

  const [structured, setStructured] = useState<HysteriaConfig | undefined>();
  const [raw, setRaw] = useState("");
  const [port, setPort] = useState("");
  const [tlsCert, setTlsCert] = useState("");
  const [tlsKey, setTlsKey] = useState("");
  const [obfsEnabled, setObfsEnabled] = useState(false);
  const [obfsPassword, setObfsPassword] = useState("");
  const [bwUp, setBwUp] = useState("");
  const [bwDown, setBwDown] = useState("");
  const [masqType, setMasqType] = useState("");
  const [masqProxyUrl, setMasqProxyUrl] = useState("");
  const [masqStringContent, setMasqStringContent] = useState("");
  const [aclText, setAclText] = useState("");
  const [resolverType, setResolverType] = useState("");
  const [resolverAddr, setResolverAddr] = useState("");
  const [resolverTimeout, setResolverTimeout] = useState("");
  const [resolverSni, setResolverSni] = useState("");
  const [validityDays, setValidityDays] = useState("3650");
  const [dirty, setDirty] = useState(false);

  function hydrate(c: ConfigResponse) {
    setRaw(c.rawYaml);
    setStructured(c.structured);
    const s = c.structured;
    setPort(listenPort(s?.listen ?? ""));
    setTlsCert(s?.tls?.cert ?? "");
    setTlsKey(s?.tls?.key ?? "");
    setObfsEnabled(s?.obfs?.type?.toLowerCase() === "salamander");
    setObfsPassword(s?.obfs?.password ?? "");
    setBwUp(s?.bandwidth?.up ?? "");
    setBwDown(s?.bandwidth?.down ?? "");
    setMasqType(s?.masquerade?.type ?? "");
    setMasqProxyUrl(s?.masquerade?.proxyUrl ?? "");
    setMasqStringContent(s?.masquerade?.stringContent ?? "");
    setAclText((s?.acl?.inline ?? []).join("\n"));
    setResolverType(s?.resolver?.type ?? "");
    setResolverAddr(s?.resolver?.addr ?? "");
    setResolverTimeout(s?.resolver?.timeout ?? "");
    setResolverSni(s?.resolver?.sni ?? "");
  }

  const { data, isLoading, error, refetch } = useQuery(getConfig, {});
  const certQuery = useQuery(getCertInfo, {});
  const cert = certQuery.data;

  useEffect(() => {
    if (data) hydrate(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  useLoadErrorToast(error ?? certQuery.error, "server-load");

  function invalidate() {
    queryClient.invalidateQueries({
      queryKey: createConnectQueryKey({ schema: getConfig, transport, cardinality: "finite" }),
    });
    queryClient.invalidateQueries({
      queryKey: createConnectQueryKey({ schema: getCertInfo, transport, cardinality: "finite" }),
    });
  }

  function onSaved(c: ConfigResponse) {
    hydrate(c);
    setDirty(true);
    toast.success(c.managedBlocksReasserted ? "Saved. Managed auth/trafficStats blocks reasserted." : "Saved.");
    invalidate();
  }

  const saveStructuredMutation = useMutation(updateConfig, { onSuccess: onSaved, onError: (e) => toast.error(e.message) });
  const saveRawMutation = useMutation(updateRawConfig, { onSuccess: onSaved, onError: (e) => toast.error(e.message) });
  const generateCertMutation = useMutation(generateCert, { onSuccess: () => { setDirty(true); invalidate(); } });
  const saving = saveStructuredMutation.isPending;
  const savingRaw = saveRawMutation.isPending;

  function saveStructured() {
    const p = port.trim();
    if (!/^\d+$/.test(p) || Number(p) < 1 || Number(p) > 65535) {
      toast.error("Port must be a number between 1 and 65535.");
      return;
    }
    saveStructuredMutation.mutate({
      structured: {
        listen: setListenPort(structured?.listen ?? "", p),
        tls: { cert: tlsCert.trim(), key: tlsKey.trim() },
        obfs: {
          type: obfsEnabled ? "salamander" : "",
          password: obfsEnabled ? obfsPassword.trim() : "",
        },
        bandwidth: { up: bwUp.trim(), down: bwDown.trim() },
        masquerade: {
          type: masqType,
          proxyUrl: masqType === "proxy" ? masqProxyUrl.trim() : "",
          stringContent: masqType === "string" ? masqStringContent : "",
        },
        acl: {
          inline: aclText
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean),
        },
        resolver: {
          type: resolverType,
          addr: resolverType ? resolverAddr.trim() : "",
          timeout: resolverType ? resolverTimeout.trim() : "",
          sni: resolverType === "tls" || resolverType === "https" ? resolverSni.trim() : "",
        },
      },
    });
  }

  async function generate() {
    const days = Number(validityDays);
    if (!Number.isFinite(days) || days <= 0) throw new Error("Validity must be a positive number of days.");
    await generateCertMutation.mutateAsync({
      sans: [],
      validityDays: Math.floor(days),
      certPath: tlsCert.trim(),
      keyPath: tlsKey.trim(),
    });
  }

  if (isLoading) return <Skeleton className="h-[420px]" />;

  return (
    <div className="flex flex-col gap-6">
      {dirty && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-border bg-muted-bg/40 px-4 py-3 text-sm">
          <span>Changes are saved to disk. Restart the core to apply them.</span>
          <RestartCoreButton variant="default" size="sm" onRestarted={() => setDirty(false)} />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Listen</CardTitle>
          <CardDescription>UDP port the core binds. Client links use the same port.</CardDescription>
        </CardHeader>
        <CardContent>
          <Field id="port" label="Port">
            <Input id="port" value={port} onChange={(e) => setPort(e.target.value)} placeholder="443" spellCheck={false} className="max-w-[160px]" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>TLS certificate</CardTitle>
          <CardDescription>Self-signed. Clients pin it, so no domain is needed. Paths are saved with the form; Generate writes to them.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="tls_cert" label="Certificate path">
              <Input id="tls_cert" value={tlsCert} onChange={(e) => setTlsCert(e.target.value)} placeholder="/etc/hysteria/fullchain.pem" spellCheck={false} />
            </Field>
            <Field id="tls_key" label="Key path">
              <Input id="tls_key" value={tlsKey} onChange={(e) => setTlsKey(e.target.value)} placeholder="/etc/hysteria/privkey.pem" spellCheck={false} />
            </Field>
          </div>
          <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-border bg-muted-bg/40 p-3">
            {cert?.parseError ? (
              <Badge variant="off">Unreadable: {cert.parseError}</Badge>
            ) : cert?.exists ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{cert.subjectCn || "(no CN)"}</span>
                  {cert.expired ? <Badge variant="off">Expired</Badge> : <Badge variant="on">Valid until {fmtTs(cert.notAfter)}</Badge>}
                </div>
                {cert.sans.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {cert.sans.map((s) => (
                      <Badge key={s} variant="neutral">{s}</Badge>
                    ))}
                  </div>
                )}
                <PinRow label="pinSHA256" value={cert.fingerprintSha256} />
                <PinRow label="sing-box" value={cert.publicKeySha256} />
              </>
            ) : (
              <Badge variant="neutral">No certificate yet</Badge>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Field id="cert_days" label="Validity (days)">
              <Input id="cert_days" type="number" min={1} value={validityDays} onChange={(e) => setValidityDays(e.target.value)} className="max-w-[140px]" />
            </Field>
            <AsyncActionButton
              action={generate}
              successMessage="Certificate generated."
              renderIcon={() => <ShieldPlus className="size-4" />}
              busyLabel="Generating…"
              confirm={
                cert?.exists
                  ? {
                      title: "Regenerate certificate?",
                      description: "Every issued client link and QR code stops working. Clients must be re-provisioned.",
                      confirmLabel: "Regenerate",
                    }
                  : undefined
              }
            >
              {cert?.exists ? "Regenerate" : "Generate"}
            </AsyncActionButton>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Obfuscation</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Switch id="obfs" checked={obfsEnabled} onCheckedChange={setObfsEnabled} />
            <Label htmlFor="obfs" className="cursor-pointer">Salamander</Label>
          </div>
          {obfsEnabled && (
            <Field id="obfs_password" label="Password">
              <div className="flex gap-2">
                <Input id="obfs_password" value={obfsPassword} onChange={(e) => setObfsPassword(e.target.value)} spellCheck={false} className="flex-1" />
                <Button type="button" variant="secondary" onClick={() => setObfsPassword(generateSecret())}>
                  <Dices className="size-4" />
                  Generate
                </Button>
              </div>
            </Field>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bandwidth</CardTitle>
          <CardDescription>Per-connection caps. Blank = no fixed cap.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field id="bw_up" label="Up">
            <Input id="bw_up" value={bwUp} onChange={(e) => setBwUp(e.target.value)} placeholder="100 mbps" spellCheck={false} />
          </Field>
          <Field id="bw_down" label="Down">
            <Input id="bw_down" value={bwDown} onChange={(e) => setBwDown(e.target.value)} placeholder="100 mbps" spellCheck={false} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Masquerade</CardTitle>
          <CardDescription>What probes see instead of a Hysteria server.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field id="masq_type" label="Type">
            <Select id="masq_type" value={masqType} onChange={(e) => setMasqType(e.target.value)} className="sm:max-w-[240px]">
              <option value="">Off</option>
              <option value="proxy">Reverse proxy</option>
              <option value="string">Fixed string</option>
              <option value="file">Static files (path in raw YAML)</option>
            </Select>
          </Field>
          {masqType === "proxy" && (
            <Field id="masq_proxy" label="Upstream URL">
              <Input id="masq_proxy" value={masqProxyUrl} onChange={(e) => setMasqProxyUrl(e.target.value)} placeholder="https://news.ycombinator.com/" spellCheck={false} />
            </Field>
          )}
          {masqType === "string" && (
            <Field id="masq_string" label="Response body">
              <Textarea id="masq_string" value={masqStringContent} onChange={(e) => setMasqStringContent(e.target.value)} spellCheck={false} className="min-h-[100px] font-mono text-xs" />
            </Field>
          )}
          {masqType === "file" && (
            <p className="text-xs text-muted">Set the directory under <code>masquerade.file</code> in the raw YAML below.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>ACL</CardTitle>
          <CardDescription>Inline rules, one per line, top to bottom. Blank = no ACL.</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={aclText}
            onChange={(e) => setAclText(e.target.value)}
            spellCheck={false}
            placeholder={"reject(10.0.0.0/8)\nreject(192.168.0.0/16)\ndirect(all)"}
            className="min-h-[160px] font-mono text-xs leading-relaxed"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Resolver</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field id="resolver_type" label="Type">
            <Select id="resolver_type" value={resolverType} onChange={(e) => setResolverType(e.target.value)} className="sm:max-w-[240px]">
              <option value="">System resolver</option>
              <option value="dns">DNS (UDP with TCP fallback)</option>
              <option value="udp">UDP</option>
              <option value="tcp">TCP</option>
              <option value="tls">DNS over TLS</option>
              <option value="https">DNS over HTTPS</option>
            </Select>
          </Field>
          {resolverType && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="resolver_addr" label="Address">
                <Input id="resolver_addr" value={resolverAddr} onChange={(e) => setResolverAddr(e.target.value)} placeholder={resolverType === "https" ? "1.1.1.1:443" : "1.1.1.1:53"} spellCheck={false} />
              </Field>
              <Field id="resolver_timeout" label="Timeout">
                <Input id="resolver_timeout" value={resolverTimeout} onChange={(e) => setResolverTimeout(e.target.value)} placeholder="10s" spellCheck={false} />
              </Field>
              {(resolverType === "tls" || resolverType === "https") && (
                <Field id="resolver_sni" label="SNI">
                  <Input id="resolver_sni" value={resolverSni} onChange={(e) => setResolverSni(e.target.value)} placeholder="cloudflare-dns.com" spellCheck={false} />
                </Field>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button onClick={saveStructured} disabled={saving}>
          <Save className="size-4" />
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button variant="secondary" onClick={() => refetch()} disabled={saving}>
          <RotateCw className="size-4" />
          Reload
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <details>
            <summary className="cursor-pointer text-sm font-medium">Raw YAML</summary>
            <div className="mt-4 flex flex-col gap-3">
              <p className="text-sm text-muted">
                The full config.yaml, for anything the form doesn't cover. Unknown keys are kept. The panel-managed
                auth and trafficStats blocks are reasserted on save.
              </p>
              <Textarea value={raw} onChange={(e) => setRaw(e.target.value)} spellCheck={false} className="min-h-[360px] font-mono text-xs leading-relaxed" />
              <div>
                <Button onClick={() => saveRawMutation.mutate({ rawYaml: raw })} disabled={savingRaw}>
                  <Save className="size-4" />
                  {savingRaw ? "Saving…" : "Save YAML"}
                </Button>
              </div>
            </div>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}

function PinRow({ label, value }: { label: string; value: string }) {
  return (
    <p className="break-all font-mono text-xs text-muted">
      <span className="text-foreground">{label}</span>{" "}
      <button
        type="button"
        className="text-left hover:text-foreground"
        title="Copy"
        onClick={() => navigator.clipboard.writeText(value).then(() => toast.success("Copied"))}
      >
        {value}
      </button>
    </p>
  );
}
