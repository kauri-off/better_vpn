import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Save, RotateCw, ShieldPlus, KeyRound } from "lucide-react";
import { useMutation, useQuery, useTransport, createConnectQueryKey } from "@connectrpc/connect-query";
import { useQueryClient } from "@tanstack/react-query";
import { getSettings, updateSettings, getCertInfo, generateCert, setAdminToken } from "../gen/panel-PanelService_connectquery";
import { fmtTs, setToken } from "../api";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Alert } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Skeleton } from "../components/ui/skeleton";
import { RestartCoreButton } from "../components/RestartCoreButton";
import { UpdateCoreButton } from "../components/UpdateCoreButton";
import { AsyncActionButton } from "../components/AsyncActionButton";

export default function Settings() {
  const queryClient = useQueryClient();
  const transport = useTransport();

  const [port, setPort] = useState("");
  const [sni, setSni] = useState("");
  const [commonName, setCommonName] = useState("");
  const [validityDays, setValidityDays] = useState("3650");
  const [newToken, setNewToken] = useState("");
  const [issuedToken, setIssuedToken] = useState("");

  const settingsQuery = useQuery(getSettings, {});
  const certQuery = useQuery(getCertInfo, {});
  const cert = certQuery.data ?? null;
  const loading = settingsQuery.isLoading || certQuery.isLoading;
  const error = settingsQuery.error ?? certQuery.error ?? null;

  // Seed editable fields from the fetched settings/cert (and on every reload).
  useEffect(() => {
    const s = settingsQuery.data;
    if (s) {
      setPort(s.port);
      setSni(s.sni);
    }
  }, [settingsQuery.data]);

  useEffect(() => {
    const c = certQuery.data;
    if (c) setCommonName(c.exists && !c.parseError ? c.subjectCn : "");
  }, [certQuery.data]);

  function reload() {
    settingsQuery.refetch();
    certQuery.refetch();
  }

  const updateSettingsMutation = useMutation(updateSettings, {
    onSuccess: (s) => {
      setPort(s.port);
      setSni(s.sni);
      toast.success("Saved. If the port changed, the core was restarted to bind it; new links use these values.");
      queryClient.invalidateQueries({
        queryKey: createConnectQueryKey({ schema: getSettings, transport, cardinality: "finite" }),
      });
    },
    onError: (err) => toast.error(err.message),
  });
  const saving = updateSettingsMutation.isPending;

  function save() {
    updateSettingsMutation.mutate({ port: port.trim(), sni: sni.trim() });
  }

  // Errors here surface through AsyncActionButton's own toast, so no onError.
  const generateCertMutation = useMutation(generateCert, {
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: createConnectQueryKey({ schema: getCertInfo, transport, cardinality: "finite" }),
      });
    },
  });

  // Errors here surface through AsyncActionButton's own toast, so no onError.
  const setAdminTokenMutation = useMutation(setAdminToken, {
    onSuccess: (resp) => {
      // The old token no longer matches the stored hash, so adopt the new one
      // for this session immediately (otherwise the next request 401s and boots
      // us to the login page).
      setToken(resp.token);
      setIssuedToken(resp.token);
      setNewToken("");
    },
  });

  async function rotateToken() {
    await setAdminTokenMutation.mutateAsync({ token: newToken.trim() });
  }

  async function generate() {
    const days = Number(validityDays);
    if (!Number.isFinite(days) || days <= 0) {
      // Don't silently coerce a bad value to 0 (which the backend would treat
      // as its 10-year default) — surface it so the operator can fix it.
      throw new Error("Validity (days) must be a positive number.");
    }
    // No SANs by design: clients trust the cert by its pin, and an empty SAN
    // set frees the SNI (Hysteria's sniGuard only validates when a DNS SAN
    // exists). So the panel never offers a SAN field.
    await generateCertMutation.mutateAsync({
      commonName: commonName.trim(),
      sans: [],
      validityDays: Math.floor(days),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <Alert>{error.message}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Connection</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {loading ? (
            <Skeleton className="h-[180px]" />
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="port">Port</Label>
                <Input
                  id="port"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="443"
                  spellCheck={false}
                  className="max-w-[160px]"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sni">SNI</Label>
                <Input
                  id="sni"
                  value={sni}
                  onChange={(e) => setSni(e.target.value)}
                  placeholder="vpn.example.com"
                  spellCheck={false}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={save} disabled={saving}>
                  <Save className="size-4" />
                  {saving ? "Saving…" : "Save settings"}
                </Button>
                <Button variant="secondary" onClick={reload} disabled={saving}>
                  <RotateCw className="size-4" />
                  Reload
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Admin access token</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            A single token authenticates the panel and console. Leave the field blank to generate a
            strong random one. Changing it signs out every other session (and the vpnctl console)
            until they log in with the new token; this browser stays signed in.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="admin_token">New token (blank = generate)</Label>
            <Input
              id="admin_token"
              type="password"
              value={newToken}
              onChange={(e) => setNewToken(e.target.value)}
              placeholder="leave blank to generate"
              spellCheck={false}
              autoComplete="new-password"
            />
          </div>
          <div>
            <AsyncActionButton
              action={rotateToken}
              successMessage="Admin token changed. Other sessions must sign in again."
              renderIcon={() => <KeyRound className="size-4" />}
              busyLabel="Changing…"
              confirm={{
                title: "Change admin token?",
                description:
                  "This immediately invalidates the current token everywhere. Every other signed-in session and the vpnctl console must log in again with the new token. This browser will keep working.",
                confirmLabel: "Change token",
              }}
            >
              Change token
            </AsyncActionButton>
          </div>
          {issuedToken && (
            <Alert>
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">New token — copy it now, it isn't shown again:</span>
                <code className="break-all font-mono text-xs">{issuedToken}</code>
              </div>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>TLS certificate (self-signed)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {loading ? (
            <Skeleton className="h-[260px]" />
          ) : (
            <>
              {/* Current certificate */}
              <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-border bg-muted-bg/40 p-3">
                {cert?.parseError ? (
                  <Badge variant="off">Unreadable: {cert.parseError}</Badge>
                ) : cert?.exists ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{cert.subjectCn || "(no CN)"}</span>
                      {cert.expired ? (
                        <Badge variant="off">Expired</Badge>
                      ) : (
                        <Badge variant="on">Valid until {fmtTs(cert.notAfter)}</Badge>
                      )}
                    </div>
                    {cert.sans.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {cert.sans.map((s) => (
                          <Badge key={s} variant="neutral">
                            {s}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <p className="break-all font-mono text-xs text-muted">
                      <span className="text-foreground">pinSHA256</span> {cert.fingerprintSha256}
                    </p>
                    <p className="font-mono text-xs text-muted">{cert.certPath}</p>
                  </>
                ) : (
                  <Badge variant="neutral">No certificate yet</Badge>
                )}
              </div>

              {/* Generate form */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cert_cn">Common name (optional)</Label>
                <Input
                  id="cert_cn"
                  value={commonName}
                  onChange={(e) => setCommonName(e.target.value)}
                  placeholder="defaults to localhost"
                  spellCheck={false}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cert_days">Validity (days)</Label>
                <Input
                  id="cert_days"
                  type="number"
                  min={1}
                  value={validityDays}
                  onChange={(e) => setValidityDays(e.target.value)}
                  className="max-w-[160px]"
                />
              </div>

              <div>
                <AsyncActionButton
                  action={generate}
                  successMessage="Certificate generated and wired into the config."
                  renderIcon={() => <ShieldPlus className="size-4" />}
                  busyLabel="Generating…"
                  // Regenerating invalidates every previously issued client
                  // link/QR, so confirm before replacing an existing cert.
                  confirm={
                    cert?.exists
                      ? {
                          title: "Regenerate certificate?",
                          description:
                            "This replaces the current certificate and invalidates every previously issued client link and QR code. Existing clients must be re-provisioned.",
                          confirmLabel: "Regenerate",
                        }
                      : undefined
                  }
                >
                  {cert?.exists ? "Regenerate certificate" : "Generate certificate"}
                </AsyncActionButton>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Hysteria core</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Alert>
            <div className="flex flex-col items-start gap-2">
              <span>
                Download the latest Hysteria 2 release, replace the core binary, and restart it.
                The downloaded binary is validated before it replaces the running one, so a failed
                download leaves the current core untouched. The detected version is shown on the
                Stats page.
              </span>
              <div className="flex flex-wrap gap-2">
                <UpdateCoreButton variant="default" size="sm" />
                <RestartCoreButton variant="secondary" size="sm" />
              </div>
            </div>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}
