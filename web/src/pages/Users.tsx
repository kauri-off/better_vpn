import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Ban,
  CheckCircle2,
  Copy,
  MoreHorizontal,
  PlugZap,
  Plus,
  QrCode,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { useMutation, useQuery } from "@connectrpc/connect-query";
import { keepPreviousData } from "@tanstack/react-query";
import {
  listUsers,
  updateUser,
  kickUser,
  resetUserUsage,
  deleteUser,
  createUser,
  getUserConfig,
} from "../gen/panel-PanelService_connectquery";
import { POLL_MS, fmtBytes, fmtTs } from "../api";
import { copyText } from "../lib/utils";
import type { VpnUser } from "../gen/panel_pb";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import { Skeleton } from "../components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";

export default function Users() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<
    { uri: string; token: string; qr: string; username?: string; fresh: boolean } | null
  >(null);
  const [confirmDelete, setConfirmDelete] = useState<VpnUser | null>(null);

  // Row mutations. `act()` refetches the list for instant feedback; the poll
  // keeps it fresh afterwards.
  const updateUserMutation = useMutation(updateUser);
  const kickUserMutation = useMutation(kickUser);
  const resetUsageMutation = useMutation(resetUserUsage);
  const deleteUserMutation = useMutation(deleteUser);
  const userConfigMutation = useMutation(getUserConfig);

  // Debounce per-keystroke search so we don't refetch on every letter.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  // Poll the list on the backend's stats cadence (online counts / usage change
  // there). keepPreviousData holds the current rows while a new search loads,
  // so typing filters without skeleton flicker.
  const {
    data,
    isLoading: loading,
    error,
    refetch,
  } = useQuery(
    listUsers,
    { search: debouncedSearch, limit: 200, offset: 0 },
    { refetchInterval: POLL_MS, placeholderData: keepPreviousData },
  );
  const users = data?.users ?? [];

  // Stable toast id: repeated failures update one toast instead of stacking.
  useEffect(() => {
    if (error) toast.error(error.message, { id: "users-poll" });
    else toast.dismiss("users-poll");
    return () => {
      toast.dismiss("users-poll");
    };
  }, [error]);

  async function act(label: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      await refetch();
      toast.success(label);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function showConfig(u: VpnUser) {
    try {
      const resp = await userConfigMutation.mutateAsync({ id: u.id, linkHost: window.location.hostname });
      if (!resp.connectionUri) {
        toast.error("No stored connection for this user — recreate it to get a link.");
        return;
      }
      setCreated({
        uri: resp.connectionUri,
        token: resp.authToken,
        qr: resp.qrSvg,
        username: resp.username,
        fresh: false,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input
            placeholder="Search users…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          Add user
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Online</TableHead>
                <TableHead>Used / Quota</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted">
                    {search ? "No users match your search." : "No users yet. Add one to get started."}
                  </TableCell>
                </TableRow>
              ) : (
                users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="text-muted tabular-nums">{u.id}</TableCell>
                    <TableCell className="font-medium">{u.username}</TableCell>
                    <TableCell>
                      <Badge variant={u.enabled ? "on" : "off"}>
                        {u.enabled ? "enabled" : "disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {u.connections > 0 ? (
                        <span className="inline-flex items-center gap-1.5 text-ok">
                          <span className="size-2 rounded-full bg-ok" />
                          {u.connections}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {fmtBytes(u.usedBytes)}
                      <span className="text-muted">
                        {u.quotaBytes > 0n ? ` / ${fmtBytes(u.quotaBytes)}` : " / ∞"}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted">{fmtTs(u.expiresAt)}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="Actions">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onSelect={() => showConfig(u)}>
                            <QrCode /> Show QR
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              act(
                                u.enabled ? "User disabled" : "User enabled",
                                () => updateUserMutation.mutateAsync({ id: u.id, enabled: !u.enabled }),
                              )
                            }
                          >
                            {u.enabled ? <Ban /> : <CheckCircle2 />}
                            {u.enabled ? "Disable" : "Enable"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => act("User kicked", () => kickUserMutation.mutateAsync({ id: u.id }))}
                          >
                            <PlugZap /> Kick
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              act("Usage reset", () => resetUsageMutation.mutateAsync({ id: u.id }))
                            }
                          >
                            <RotateCcw /> Reset usage
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem destructive onSelect={() => setConfirmDelete(u)}>
                            <Trash2 /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(c) => {
          setCreated({ ...c, fresh: true });
          void refetch();
        }}
      />

      <ConnectionDialog created={created} onClose={() => setCreated(null)} />

      {/* Delete confirm */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete user?</DialogTitle>
            <DialogDescription>
              This permanently deletes <strong className="text-foreground">{confirmDelete?.username}</strong>.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                const u = confirmDelete!;
                setConfirmDelete(null);
                act("User deleted", () => deleteUserMutation.mutateAsync({ id: u.id }));
              }}
            >
              <Trash2 className="size-4" />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (c: { uri: string; token: string; qr: string }) => void;
}) {
  const [username, setUsername] = useState("");
  const [quotaGb, setQuotaGb] = useState("0");
  const [expiresDays, setExpiresDays] = useState("0");
  const [busy, setBusy] = useState(false);
  const createUserMutation = useMutation(createUser);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const quotaGbNum = parseFloat(quotaGb || "0");
      if (!Number.isFinite(quotaGbNum) || quotaGbNum < 0) {
        throw new Error("Quota (GB) must be a non-negative number.");
      }
      const quota = BigInt(Math.round(quotaGbNum * 1024 ** 3));
      const days = parseInt(expiresDays || "0", 10);
      if (!Number.isFinite(days) || days < 0) {
        throw new Error("Expiry (days) must be a non-negative number.");
      }
      const expires = days > 0 ? BigInt(Math.floor(Date.now() / 1000) + days * 86400) : 0n;
      const resp = await createUserMutation.mutateAsync({
        username,
        quotaBytes: quota,
        expiresAt: expires,
        note: "",
        enabled: true,
        linkHost: window.location.hostname,
      });
      onCreated({ uri: resp.connectionUri, token: resp.authToken, qr: resp.qrSvg });
      toast.success("User created");
      setUsername("");
      setQuotaGb("0");
      setExpiresDays("0");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>Create a new VPN account. The connection URI is shown once.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cu-username">Username</Label>
            <Input id="cu-username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cu-quota">Quota (GB, 0 = ∞)</Label>
              <Input id="cu-quota" value={quotaGb} onChange={(e) => setQuotaGb(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cu-expires">Expires (days, 0 = never)</Label>
              <Input id="cu-expires" value={expiresDays} onChange={(e) => setExpiresDays(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConnectionDialog({
  created,
  onClose,
}: {
  created: { uri: string; token: string; qr: string; username?: string; fresh: boolean } | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!created} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {created?.fresh ? "User created" : `Connection — ${created?.username ?? ""}`}
          </DialogTitle>
          <DialogDescription>
            Scan the QR code in v2rayNG / v2rayN, or copy the connection URI to set up a client.
          </DialogDescription>
        </DialogHeader>
        {created?.qr && (
          <div
            className="mx-auto size-48 [&>svg]:size-full rounded-[var(--radius)] border border-border bg-white p-2"
            // The SVG is generated server-side from the connection URI.
            dangerouslySetInnerHTML={{ __html: created.qr }}
          />
        )}
        <div className="break-all rounded-[var(--radius)] border border-border bg-muted-bg p-3 font-mono text-xs">
          {created?.uri}
        </div>
        <DialogFooter>
          <Button
            onClick={async () => {
              if (!created) return;
              if (await copyText(created.uri)) {
                toast.success("URI copied to clipboard");
              } else {
                toast.error("Couldn't copy — select the URI and copy manually.");
              }
            }}
          >
            <Copy className="size-4" />
            Copy URI
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
