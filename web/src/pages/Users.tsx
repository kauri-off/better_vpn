import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Ban,
  CheckCircle2,
  Copy,
  MoreHorizontal,
  Pencil,
  PlugZap,
  Plus,
  QrCode,
  RotateCcw,
  Search,
  Trash2,
  X,
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
import { POLL_MS, fmtBytes, fmtRelative, fmtTs } from "../api";
import { cn, copyText } from "../lib/utils";
import type { VpnUser } from "../gen/panel_pb";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { CardContent } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import { Skeleton } from "../components/ui/skeleton";
import { Switch } from "../components/ui/switch";
import { Textarea } from "../components/ui/textarea";
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

// ---- derived user state helpers -------------------------------------------
// The raw `enabled` flag doesn't tell the whole story: an enabled user can be
// silently unusable because they're expired or over quota. These helpers fold
// all the signals into one honest status and drive the filters/summary.

const DAY = 86400;
const nowSec = () => Math.floor(Date.now() / 1000);

const isExpired = (u: VpnUser) => u.expiresAt > 0n && Number(u.expiresAt) <= nowSec();
const isOverQuota = (u: VpnUser) => u.quotaBytes > 0n && u.usedBytes >= u.quotaBytes;
const expiringSoon = (u: VpnUser) => {
  if (u.expiresAt <= 0n) return false;
  const s = Number(u.expiresAt);
  return s > nowSec() && s - nowSec() <= 7 * DAY;
};

/** null = unlimited quota (no bar); otherwise raw percent (may exceed 100). */
function usagePct(u: VpnUser): number | null {
  if (u.quotaBytes <= 0n) return null;
  return (Number(u.usedBytes) / Number(u.quotaBytes)) * 100;
}

type StatusVariant = "on" | "off" | "warn" | "neutral";
function userStatus(u: VpnUser): { label: string; variant: StatusVariant; pulse?: boolean } {
  if (!u.enabled) return { label: "disabled", variant: "off" };
  if (isExpired(u)) return { label: "expired", variant: "off" };
  if (isOverQuota(u)) return { label: "over quota", variant: "warn" };
  if (u.connections > 0)
    return { label: u.connections > 1 ? `${u.connections} online` : "online", variant: "on", pulse: true };
  if (u.lastSeen <= 0n) return { label: "never used", variant: "neutral" };
  return { label: "idle", variant: "neutral" };
}

type Filter = "all" | "online" | "disabled" | "over" | "expiring";
type SortKey = "username" | "usage" | "expires" | "lastSeen";

export default function Users() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "username",
    dir: "asc",
  });
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<VpnUser | null>(null);
  const [created, setCreated] = useState<
    { uri: string; token: string; qr: string; username?: string; fresh: boolean } | null
  >(null);
  const [confirmDelete, setConfirmDelete] = useState<VpnUser | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

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
  const users = useMemo(() => data?.users ?? [], [data]);

  // Summary is computed from the full server response (pre client-side filter),
  // and the cards double as the filter control — clicking one narrows the table.
  const summary = useMemo(() => {
    let online = 0,
      disabled = 0,
      over = 0,
      expiring = 0;
    for (const u of users) {
      if (u.connections > 0) online++;
      if (!u.enabled) disabled++;
      if (isOverQuota(u)) over++;
      if (expiringSoon(u)) expiring++;
    }
    return { total: users.length, online, disabled, over, expiring };
  }, [users]);

  // Client-side filter (chips/cards) + sort on top of the fetched rows.
  const visible = useMemo(() => {
    const pred: Record<Filter, (u: VpnUser) => boolean> = {
      all: () => true,
      online: (u) => u.connections > 0,
      disabled: (u) => !u.enabled,
      over: isOverQuota,
      expiring: expiringSoon,
    };
    const rows = users.filter(pred[filter]);
    const dir = sort.dir === "asc" ? 1 : -1;
    // null = "no value" (e.g. unlimited quota); these always sink to the
    // bottom regardless of sort direction rather than flipping to the top.
    const key = (u: VpnUser): number | string | null => {
      switch (sort.key) {
        case "username":
          return u.username.toLowerCase();
        case "usage":
          return usagePct(u);
        case "expires":
          return u.expiresAt <= 0n ? Number.MAX_SAFE_INTEGER : Number(u.expiresAt);
        case "lastSeen":
          return Number(u.lastSeen);
      }
    };
    return [...rows].sort((a, b) => {
      const ka = key(a),
        kb = key(b);
      if (ka === null || kb === null) {
        if (ka === kb) return 0;
        return ka === null ? 1 : -1;
      }
      if (ka < kb) return -1 * dir;
      if (ka > kb) return 1 * dir;
      return 0;
    });
  }, [users, filter, sort]);

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

  // Run a mutation across all selected ids, then report an aggregate result.
  async function bulk(label: string, run: (id: number) => Promise<unknown>) {
    const ids = [...selected];
    if (ids.length === 0) return;
    const results = await Promise.allSettled(ids.map(run));
    const failed = results.filter((r) => r.status === "rejected").length;
    await refetch();
    setSelected(new Set());
    if (failed) toast.error(`${label}: ${failed} of ${ids.length} failed`);
    else toast.success(`${label} (${ids.length})`);
  }

  async function showConfig(u: VpnUser) {
    try {
      const resp = await userConfigMutation.mutateAsync({
        id: u.id,
        linkHost: window.location.hostname,
      });
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

  function toggleSelect(id: number, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  const visibleIds = visible.map((u) => u.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someSelected = visibleIds.some((id) => selected.has(id));

  return (
    <div className="flex flex-col gap-4">
      {/* Summary cards double as the primary filter control. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Total users" value={summary.total} active={filter === "all"} onClick={() => setFilter("all")} />
        <StatCard label="Online now" value={summary.online} tone="ok" active={filter === "online"} onClick={() => setFilter(filter === "online" ? "all" : "online")} />
        <StatCard label="Over quota" value={summary.over} tone="warn" active={filter === "over"} onClick={() => setFilter(filter === "over" ? "all" : "over")} />
        <StatCard label="Expiring ≤7d" value={summary.expiring} tone="warn" active={filter === "expiring"} onClick={() => setFilter(filter === "expiring" ? "all" : "expiring")} />
        <StatCard label="Disabled" value={summary.disabled} tone="muted" active={filter === "disabled"} onClick={() => setFilter(filter === "disabled" ? "all" : "disabled")} />
      </div>

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

      {/* Bulk action bar appears only with a selection. */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-border bg-muted-bg px-3 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <div className="flex-1" />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => bulk("Enabled", (id) => updateUserMutation.mutateAsync({ id, enabled: true }))}
          >
            <CheckCircle2 className="size-4" /> Enable
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => bulk("Disabled", (id) => updateUserMutation.mutateAsync({ id, enabled: false }))}
          >
            <Ban className="size-4" /> Disable
          </Button>
          <Button variant="destructive" size="sm" onClick={() => setConfirmBulkDelete(true)}>
            <Trash2 className="size-4" /> Delete
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            <X className="size-4" /> Clear
          </Button>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <RowCheckbox
                    label="Select all"
                    checked={allSelected}
                    indeterminate={someSelected && !allSelected}
                    onChange={(on) =>
                      setSelected(on ? new Set([...selected, ...visibleIds]) : new Set())
                    }
                  />
                </TableHead>
                <SortHead label="User" k="username" sort={sort} setSort={setSort} />
                <TableHead>Status</TableHead>
                <TableHead>Enabled</TableHead>
                <SortHead label="Used / Quota" k="usage" sort={sort} setSort={setSort} />
                <SortHead label="Expires" k="expires" sort={sort} setSort={setSort} />
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
              ) : visible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted">
                    {search || filter !== "all"
                      ? "No users match the current filter."
                      : "No users yet. Add one to get started."}
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((u) => {
                  const status = userStatus(u);
                  return (
                    <TableRow
                      key={u.id}
                      className="cursor-pointer"
                      onClick={() => setEditUser(u)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <RowCheckbox
                          label={`Select ${u.username}`}
                          checked={selected.has(u.id)}
                          onChange={(on) => toggleSelect(u.id, on)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{u.username}</div>
                        <div className="flex items-center gap-1.5 text-xs text-muted">
                          <span className="tabular-nums">#{u.id}</span>
                          <span>·</span>
                          <span title={u.lastSeen > 0n ? fmtTs(u.lastSeen) : "never connected"}>
                            {u.lastSeen > 0n ? `seen ${fmtRelative(u.lastSeen)}` : "never seen"}
                          </span>
                        </div>
                        {u.note && (
                          <div className="mt-0.5 max-w-[220px] truncate text-xs text-muted" title={u.note}>
                            {u.note}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={status.variant}>
                          {status.pulse && <span className="size-2 rounded-full bg-ok" />}
                          {status.label}
                        </Badge>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Switch
                          checked={u.enabled}
                          onCheckedChange={(v) =>
                            act(v ? "User enabled" : "User disabled", () =>
                              updateUserMutation.mutateAsync({ id: u.id, enabled: v }),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <UsageBar u={u} />
                      </TableCell>
                      <TableCell>
                        <ExpiresCell u={u} />
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Show QR"
                            onClick={() => showConfig(u)}
                          >
                            <QrCode className="size-4" />
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" aria-label="Actions">
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              <DropdownMenuItem onSelect={() => setEditUser(u)}>
                                <Pencil /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => act("User kicked", () => kickUserMutation.mutateAsync({ id: u.id }))}
                              >
                                <PlugZap /> Kick
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => act("Usage reset", () => resetUsageMutation.mutateAsync({ id: u.id }))}
                              >
                                <RotateCcw /> Reset usage
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem destructive onSelect={() => setConfirmDelete(u)}>
                                <Trash2 /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
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

      <EditUserDialog
        user={editUser}
        onClose={() => setEditUser(null)}
        onShowConfig={showConfig}
        onSaved={() => {
          setEditUser(null);
          void refetch();
        }}
      />

      <ConnectionDialog created={created} onClose={() => setCreated(null)} />

      {/* Single delete confirm */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete user?</DialogTitle>
            <DialogDescription>
              This permanently deletes{" "}
              <strong className="text-foreground">{confirmDelete?.username}</strong>. This cannot be undone.
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

      {/* Bulk delete confirm */}
      <Dialog open={confirmBulkDelete} onOpenChange={(o) => !o && setConfirmBulkDelete(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {selected.size} users?</DialogTitle>
            <DialogDescription>
              This permanently deletes the selected users. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmBulkDelete(false);
                bulk("Deleted", (id) => deleteUserMutation.mutateAsync({ id }));
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

// ---- small presentational pieces ------------------------------------------

function StatCard({
  label,
  value,
  tone = "primary",
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone?: "primary" | "ok" | "warn" | "muted";
  active: boolean;
  onClick: () => void;
}) {
  const toneColor = {
    primary: "text-foreground",
    ok: "text-ok",
    warn: "text-warning",
    muted: "text-muted",
  }[tone];
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onClick())}
      className={cn(
        "cursor-pointer p-4 transition-colors hover:border-primary/60",
        active && "border-primary ring-1 ring-[var(--primary)]",
      )}
    >
      <div className={cn("text-2xl font-semibold tabular-nums", toneColor)}>{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </Card>
  );
}

function RowCheckbox({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (on: boolean) => void;
  label: string;
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = !!indeterminate;
      }}
      onChange={(e) => onChange(e.target.checked)}
      className="size-4 cursor-pointer accent-[var(--primary)]"
    />
  );
}

function SortHead({
  label,
  k,
  sort,
  setSort,
  className,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" };
  setSort: (s: { key: SortKey; dir: "asc" | "desc" }) => void;
  className?: string;
}) {
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={className}>
      <button
        type="button"
        className={cn(
          "inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground",
          active && "text-foreground",
        )}
        onClick={() => setSort({ key: k, dir: active && sort.dir === "asc" ? "desc" : "asc" })}
      >
        {label}
        <Icon className="size-3" />
      </button>
    </TableHead>
  );
}

function UsageBar({ u }: { u: VpnUser }) {
  const pct = usagePct(u);
  const used = fmtBytes(u.usedBytes);
  if (pct === null) {
    return (
      <div className="tabular-nums text-sm">
        {used} <span className="text-muted">/ ∞</span>
      </div>
    );
  }
  const color = pct >= 100 ? "bg-destructive" : pct >= 75 ? "bg-warning" : "bg-ok";
  return (
    <div className="flex min-w-[130px] flex-col gap-1">
      <div className="tabular-nums text-sm">
        {used} <span className="text-muted">/ {fmtBytes(u.quotaBytes)}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted-bg">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}

function ExpiresCell({ u }: { u: VpnUser }) {
  if (u.expiresAt <= 0n) return <span className="text-muted">never</span>;
  const expired = isExpired(u);
  const soon = expiringSoon(u);
  return (
    <span
      title={fmtTs(u.expiresAt)}
      className={cn(expired && "text-destructive", !expired && soon && "text-warning", !expired && !soon && "text-muted")}
    >
      {expired ? `expired ${fmtRelative(u.expiresAt)}` : fmtRelative(u.expiresAt)}
    </span>
  );
}

// ---- dialogs ---------------------------------------------------------------

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
  const [note, setNote] = useState("");
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
        note: note.trim(),
        enabled: true,
        linkHost: window.location.hostname,
      });
      onCreated({ uri: resp.connectionUri, token: resp.authToken, qr: resp.qrSvg });
      toast.success("User created");
      setUsername("");
      setQuotaGb("0");
      setExpiresDays("0");
      setNote("");
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cu-note">Note (optional)</Label>
            <Textarea
              id="cu-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. billing contact, device, plan…"
            />
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

// yyyy-mm-dd (local) <-> unix seconds, for the native date input.
function toDateInput(expiresAt: bigint): string {
  if (expiresAt <= 0n) return "";
  const d = new Date(Number(expiresAt) * 1000);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
function fromDateInput(s: string): bigint {
  if (!s) return 0n;
  const ms = new Date(`${s}T23:59:59`).getTime();
  return Number.isFinite(ms) ? BigInt(Math.floor(ms / 1000)) : 0n;
}

function EditUserDialog({
  user,
  onClose,
  onSaved,
  onShowConfig,
}: {
  user: VpnUser | null;
  onClose: () => void;
  onSaved: () => void;
  onShowConfig: (u: VpnUser) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [quotaGb, setQuotaGb] = useState("0");
  const [expiresDate, setExpiresDate] = useState("");
  const [note, setNote] = useState("");
  const [token, setToken] = useState("");
  const [tokenLoading, setTokenLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const updateUserMutation = useMutation(updateUser);
  const userConfigMutation = useMutation(getUserConfig);

  // Re-seed the form whenever a different user opens the dialog. The token
  // isn't part of the VpnUser row, so fetch it separately to prefill the field.
  useEffect(() => {
    if (!user) return;
    setEnabled(user.enabled);
    setQuotaGb(user.quotaBytes > 0n ? (Number(user.quotaBytes) / 1024 ** 3).toString() : "0");
    setExpiresDate(toDateInput(user.expiresAt));
    setNote(user.note);
    setToken("");

    let cancelled = false;
    setTokenLoading(true);
    userConfigMutation
      .mutateAsync({ id: user.id, linkHost: window.location.hostname })
      .then((resp) => {
        // Ignore a stale response if the dialog moved to another user.
        if (!cancelled) setToken(resp.authToken);
      })
      .catch(() => {
        // Couldn't fetch the token (RPC/network error); leave the field blank
        // so a blank submit is treated as "unchanged" rather than clobbering it.
      })
      .finally(() => {
        if (!cancelled) setTokenLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function save() {
    if (!user) return;
    setBusy(true);
    try {
      const quotaGbNum = parseFloat(quotaGb || "0");
      if (!Number.isFinite(quotaGbNum) || quotaGbNum < 0) {
        throw new Error("Quota (GB) must be a non-negative number.");
      }
      // Blank => leave the token unchanged; only send it when it differs from
      // the current token (so we don't needlessly rewrite it).
      const trimmedToken = token.trim();
      const tokenChanged = trimmedToken.length > 0;
      await updateUserMutation.mutateAsync({
        id: user.id,
        enabled,
        quotaBytes: BigInt(Math.round(quotaGbNum * 1024 ** 3)),
        expiresAt: fromDateInput(expiresDate),
        note: note.trim(),
        token: tokenChanged ? trimmedToken : undefined,
      });
      toast.success("User updated");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {user?.username}</DialogTitle>
          <DialogDescription>Update quota, expiry, note, auth token, and enabled state.</DialogDescription>
        </DialogHeader>

        {user && (
          <>
            {/* Read-only meta the row can't fit. */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-[var(--radius)] border border-border bg-muted-bg p-3 text-sm">
              <Meta label="ID" value={`#${user.id}`} />
              <Meta label="Online devices" value={user.connections > 0 ? String(user.connections) : "—"} />
              <Meta label="Used" value={fmtBytes(user.usedBytes)} />
              <Meta label="Last seen" value={user.lastSeen > 0n ? fmtTs(user.lastSeen) : "never"} />
              <Meta label="Created" value={user.createdAt > 0n ? fmtTs(user.createdAt) : "—"} />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="eu-enabled">Enabled</Label>
              <Switch id="eu-enabled" checked={enabled} onCheckedChange={setEnabled} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="eu-quota">Quota (GB, 0 = ∞)</Label>
                <Input id="eu-quota" value={quotaGb} onChange={(e) => setQuotaGb(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="eu-expires">Expires</Label>
                <Input
                  id="eu-expires"
                  type="date"
                  value={expiresDate}
                  onChange={(e) => setExpiresDate(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="eu-note">Note</Label>
              <Textarea id="eu-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="eu-token">Auth token</Label>
              <Input
                id="eu-token"
                className="font-mono"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={tokenLoading ? "Loading…" : "No stored token"}
                spellCheck={false}
                autoComplete="off"
              />
              <p className="text-xs text-muted">
                The client's credential. Changing it disconnects existing devices until they reconnect
                with the new token.
              </p>
            </div>

            <DialogFooter className="sm:justify-between">
              <Button variant="secondary" onClick={() => onShowConfig(user)}>
                <QrCode className="size-4" /> Show connection
              </Button>
              <div className="flex gap-2">
                <DialogClose asChild>
                  <Button variant="secondary">Cancel</Button>
                </DialogClose>
                <Button onClick={save} disabled={busy}>
                  {busy ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
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
            className="mx-auto size-72 [&>svg]:size-full rounded-[var(--radius)] border border-border bg-white p-2"
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
