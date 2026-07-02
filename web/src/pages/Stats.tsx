import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Clock,
  Cpu,
  Eye,
  EyeOff,
  Globe,
  Info,
  MemoryStick,
  Network,
  Sigma,
  Users as UsersIcon,
  Wifi,
} from "lucide-react";
import { toast } from "sonner";
import { client, fmtBytes, fmtDuration, fmtRate } from "../api";
import type { ServerStats } from "../gen/panel_pb";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { cn } from "../lib/utils";

export default function Stats() {
  const [showIps, setShowIps] = useState(false);
  const [stats, setStats] = useState<ServerStats | null>(null);
  const [loading, setLoading] = useState(true);

  // Live stats stream: the server pushes a fresh snapshot immediately, then on
  // every poll tick, so the dashboard updates without client-side polling
  // (mirrors the Users table's StreamUsers).
  useEffect(() => {
    const ctrl = new AbortController();

    async function runStream() {
      // Reconnect loop: the server stream is open-ended, so `for await` only
      // ends on error or abort. On an unexpected error, back off and retry so a
      // transient blip (core restart, network hiccup) self-heals.
      while (!ctrl.signal.aborted) {
        try {
          const stream = client.streamServerStats({}, { signal: ctrl.signal });
          for await (const resp of stream) {
            setStats(resp);
            toast.dismiss("stats-stream");
            setLoading(false);
          }
        } catch (err) {
          if (ctrl.signal.aborted) return;
          // Stable id: retry failures update one toast instead of stacking.
          toast.error(err instanceof Error ? err.message : String(err), { id: "stats-stream" });
          setLoading(false);
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    }

    void runStream();
    return () => {
      ctrl.abort();
      toast.dismiss("stats-stream");
    };
  }, []);

  return (
    <div className="flex flex-col gap-6">
      {/* Metric cards */}
      {loading && !stats ? (
        <Skeleton className="h-[220px]" />
      ) : (
        stats && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={<Cpu className="size-5" />}
              tint="bg-cyan-500/15 text-cyan-500"
              label="CPU Usage"
            >
              {stats.cpuPercent.toFixed(1)}%
            </StatCard>

            <StatCard
              icon={<MemoryStick className="size-5" />}
              tint="bg-amber-500/15 text-amber-500"
              label="RAM Usage"
            >
              <span className="text-base">
                {fmtBytes(stats.memUsed)} <span className="text-muted">/ {fmtBytes(stats.memTotal)}</span>
              </span>
            </StatCard>

            <StatCard
              icon={<UsersIcon className="size-5" />}
              tint="bg-emerald-500/15 text-emerald-500"
              label="Online Users"
            >
              {stats.onlineUsers}
              <span className="ml-1 text-sm font-normal text-muted">of {stats.totalUsers}</span>
            </StatCard>

            <StatCard
              icon={<Clock className="size-5" />}
              tint="bg-slate-500/15 text-slate-400"
              label="Uptime"
            >
              <span className="text-base">{fmtDuration(stats.uptimeSecs)}</span>
            </StatCard>

            <StatCard
              icon={<Wifi className="size-5" />}
              tint="bg-blue-500/15 text-blue-500"
              label="Network Speed"
            >
              <div className="flex flex-col gap-0.5 text-sm">
                <span className="flex items-center gap-1.5">
                  <ArrowDown className="size-3.5 text-blue-500" />
                  {fmtRate(stats.netRxRate)}
                </span>
                <span className="flex items-center gap-1.5">
                  <ArrowUp className="size-3.5 text-emerald-500" />
                  {fmtRate(stats.netTxRate)}
                </span>
              </div>
            </StatCard>

            <StatCard
              icon={<Network className="size-5" />}
              tint="bg-violet-500/15 text-violet-500"
              label="Connections"
            >
              <div className="flex flex-col gap-0.5 text-sm">
                <span>
                  <span className="text-muted">TCP:</span> {stats.tcpConns}
                </span>
                <span>
                  <span className="text-muted">UDP:</span> {stats.udpConns}
                </span>
              </div>
            </StatCard>

            <StatCard
              icon={<Globe className="size-5" />}
              tint="bg-teal-500/15 text-teal-500"
              label={
                <span className="flex items-center gap-1.5">
                  Server IPs
                  <button
                    type="button"
                    onClick={() => setShowIps((v) => !v)}
                    className="text-muted hover:text-foreground"
                    aria-label={showIps ? "Hide IPs" : "Show IPs"}
                  >
                    {showIps ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                </span>
              }
            >
              <div className="flex flex-col gap-0.5 text-sm tabular-nums">
                <IpLine value={stats.ipv4} reveal={showIps} fallback="no IPv4" />
                <IpLine value={stats.ipv6} reveal={showIps} fallback="no IPv6" />
              </div>
            </StatCard>

            <StatCard
              icon={<Info className="size-5" />}
              tint="bg-indigo-500/15 text-indigo-500"
              label="Version Info"
            >
              <div className="flex flex-col items-start gap-1.5 text-sm">
                <span className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      stats.coreRunning ? "bg-emerald-500" : "bg-red-500",
                    )}
                  />
                  Core {stats.coreRunning ? "running" : "down"}
                </span>
                <span className="text-muted">{stats.coreVersion || "version unknown"}</span>
              </div>
            </StatCard>
          </div>
        )
      )}

      {/* Traffic totals */}
      {stats && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <TrafficCard
            title="Traffic Since Last Reboot"
            up={stats.rebootTx}
            down={stats.rebootRx}
          />
          <TrafficCard
            title="User Traffic (All Time)"
            up={stats.totalTx}
            down={stats.totalRx}
          />
        </div>
      )}

    </div>
  );
}

function StatCard({
  icon,
  tint,
  label,
  children,
}: {
  icon: React.ReactNode;
  tint: string;
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3.5 p-4">
        <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-lg", tint)}>
          {icon}
        </span>
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="text-xs text-muted">{label}</span>
          <div className="mt-0.5 text-lg font-semibold tabular-nums">{children}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function IpLine({ value, reveal, fallback }: { value: string; reveal: boolean; fallback: string }) {
  if (!value) return <span className="text-muted">{fallback}</span>;
  return <span>{reveal ? value : "•".repeat(Math.min(value.length, 16))}</span>;
}

function TrafficCard({ title, up, down }: { title: string; up: bigint; down: bigint }) {
  const combined = up + down;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <TrafficRow
          icon={<ArrowUp className="size-4 text-emerald-500" />}
          label="Uploaded"
          value={fmtBytes(up)}
        />
        <TrafficRow
          icon={<ArrowDown className="size-4 text-blue-500" />}
          label="Downloaded"
          value={fmtBytes(down)}
        />
        <TrafficRow
          icon={<Sigma className="size-4 text-muted" />}
          label="Combined"
          value={fmtBytes(combined)}
        />
      </CardContent>
    </Card>
  );
}

function TrafficRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-sm">
        {icon}
        {label}
      </span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}
