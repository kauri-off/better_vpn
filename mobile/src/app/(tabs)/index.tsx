import { useMutation, useQuery } from "@connectrpc/connect-query";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import {
  Appbar,
  Button,
  Card,
  Chip,
  Dialog,
  Menu,
  Portal,
  Snackbar,
  Text,
  useTheme,
} from "react-native-paper";
import Animated, { FadeInDown } from "react-native-reanimated";

import { POLL_MS } from "@/api/client";
import { useServers } from "@/api/servers";
import { Screen } from "@/components/screen";
import { Skeleton } from "@/components/skeleton";
import { Sparkline } from "@/components/sparkline";
import { StatGrid, StatTile } from "@/components/stat-tile";
import {
  getServerStats,
  restartCore,
  updateCore,
} from "@/gen/panel-PanelService_connectquery";
import { fmtBytes, fmtDuration, fmtRate } from "@/lib/format";

const HISTORY = 24; // sparkline window: 24 samples ≈ 72s at the 3s poll

export default function DashboardScreen() {
  const theme = useTheme();
  const { active } = useServers();
  // Polling pauses in the background via the focusManager wiring in api/client.
  const stats = useQuery(getServerStats, {}, { refetchInterval: POLL_MS });

  // Pull-to-refresh spinner is driven by the gesture only — binding it to
  // isRefetching would flash it on every background poll tick.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await stats.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  // Rolling rate history for the traffic sparklines. Appended as each poll
  // sample lands, keyed on dataUpdatedAt — the sanctioned set-state-in-render
  // pattern for deriving state from previous renders, no effect needed.
  const [history, setHistory] = useState<{ at: number; rx: number[]; tx: number[] }>({
    at: 0,
    rx: [],
    tx: [],
  });
  if (stats.data && stats.dataUpdatedAt !== history.at) {
    const at = stats.dataUpdatedAt;
    const rx = Number(stats.data.netRxRate);
    const tx = Number(stats.data.netTxRate);
    setHistory((h) => ({
      at,
      rx: [...h.rx, rx].slice(-HISTORY),
      tx: [...h.tx, tx].slice(-HISTORY),
    }));
  }

  // Core actions
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirm, setConfirm] = useState<"restart" | "update" | null>(null);
  const [notice, setNotice] = useState("");
  const restart = useMutation(restartCore);
  const update = useMutation(updateCore);

  const runConfirmed = async () => {
    const action = confirm;
    setConfirm(null);
    try {
      if (action === "restart") {
        await restart.mutateAsync({});
        setNotice("Core restarted");
      } else if (action === "update") {
        const res = await update.mutateAsync({});
        setNotice(`Core updated to v${res.version}`);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      stats.refetch();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };

  const copy = async (label: string, value: string) => {
    await Clipboard.setStringAsync(value);
    Haptics.selectionAsync();
    setNotice(`${label} copied`);
  };

  const d = stats.data;
  const busy = restart.isPending || update.isPending;

  return (
    <Screen
      title={active?.name ?? "Dashboard"}
      actions={
        <Menu
          visible={menuOpen}
          onDismiss={() => setMenuOpen(false)}
          anchor={<Appbar.Action icon="dots-vertical" onPress={() => setMenuOpen(true)} />}
        >
          <Menu.Item
            leadingIcon="restart"
            title="Restart core"
            disabled={busy}
            onPress={() => {
              setMenuOpen(false);
              setConfirm("restart");
            }}
          />
          <Menu.Item
            leadingIcon="download"
            title="Update core"
            disabled={busy}
            onPress={() => {
              setMenuOpen(false);
              setConfirm("update");
            }}
          />
        </Menu>
      }
    >
      {stats.isPending ? (
        <DashboardSkeleton />
      ) : stats.isError ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{stats.error.message}</Text>
          <Button mode="contained-tonal" onPress={() => stats.refetch()}>
            Retry
          </Button>
        </View>
      ) : d ? (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        >
          {/* Hero: core + host status */}
          <Card mode="contained">
            <Card.Content style={styles.heroContent}>
              <View style={styles.heroRow}>
                <Chip
                  icon={d.coreRunning ? "check-circle" : "alert-circle"}
                  compact
                  style={{
                    backgroundColor: d.coreRunning
                      ? theme.colors.secondaryContainer
                      : theme.colors.errorContainer,
                  }}
                >
                  {d.coreRunning ? "Core running" : "Core stopped"}
                </Chip>
                {!!d.coreVersion && (
                  <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                    {d.coreVersion}
                  </Text>
                )}
              </View>
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                Uptime {fmtDuration(d.uptimeSecs)}
              </Text>
              {!!d.ipv4 && (
                <Text variant="bodyMedium" onPress={() => copy("IPv4", d.ipv4)}>
                  IPv4: {d.ipv4}
                </Text>
              )}
              {!!d.ipv6 && (
                <Text variant="bodyMedium" onPress={() => copy("IPv6", d.ipv6)} numberOfLines={1}>
                  IPv6: {d.ipv6}
                </Text>
              )}
            </Card.Content>
          </Card>

          <StatGrid>
            <StatTile label="Online users" value={`${d.onlineUsers}`} sub={`of ${d.totalUsers} total`} />
            <StatTile label="CPU" value={`${d.cpuPercent.toFixed(0)}%`} />
            <StatTile
              label="Memory"
              value={fmtBytes(d.memUsed)}
              sub={`of ${fmtBytes(d.memTotal)}`}
            />
            <StatTile label="Sockets" value={`${d.tcpConns}`} sub={`TCP · ${d.udpConns} UDP`} />
          </StatGrid>

          {/* Live traffic */}
          <Card mode="contained">
            <Card.Content style={styles.trafficContent}>
              <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                Live traffic
              </Text>
              <TrafficRow label="Download" rate={Number(d.netRxRate)} history={history.rx} />
              <TrafficRow label="Upload" rate={Number(d.netTxRate)} history={history.tx} />
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                Since reboot: ↓ {fmtBytes(d.rebootRx)} · ↑ {fmtBytes(d.rebootTx)}
              </Text>
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                Users all-time: ↓ {fmtBytes(d.totalRx)} · ↑ {fmtBytes(d.totalTx)}
              </Text>
            </Card.Content>
          </Card>
        </ScrollView>
      ) : null}

      <Portal>
        <Dialog visible={confirm !== null} onDismiss={() => setConfirm(null)}>
          <Dialog.Title>{confirm === "update" ? "Update core?" : "Restart core?"}</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              {confirm === "update"
                ? "Downloads the latest Hysteria release, replaces the binary and restarts it. Active connections will drop briefly."
                : "Restarts the Hysteria core service. Active connections will drop briefly."}
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirm(null)}>Cancel</Button>
            <Button onPress={runConfirmed}>{confirm === "update" ? "Update" : "Restart"}</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar visible={!!notice} onDismiss={() => setNotice("")} duration={3000}>
        {notice}
      </Snackbar>
    </Screen>
  );
}

function TrafficRow({ label, rate, history }: { label: string; rate: number; history: number[] }) {
  const theme = useTheme();
  const value = fmtRate(rate);
  return (
    <View style={styles.trafficRow}>
      <View style={styles.trafficLabel}>
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
          {label}
        </Text>
        <Animated.View key={value} entering={FadeInDown.duration(180)}>
          <Text variant="titleMedium" style={styles.trafficValue}>
            {value}
          </Text>
        </Animated.View>
      </View>
      <Sparkline values={history} width={120} height={32} />
    </View>
  );
}

// Mirrors the loaded layout (hero card, 2×2 stat grid, traffic card) so data
// pops in without a layout shift.
function DashboardSkeleton() {
  return (
    <View style={styles.content}>
      <Skeleton height={132} radius={12} />
      <StatGrid>
        <Skeleton height={88} radius={12} style={styles.tileSkeleton} />
        <Skeleton height={88} radius={12} style={styles.tileSkeleton} />
        <Skeleton height={88} radius={12} style={styles.tileSkeleton} />
        <Skeleton height={88} radius={12} style={styles.tileSkeleton} />
      </StatGrid>
      <Skeleton height={168} radius={12} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  errorText: { textAlign: "center" },
  content: { padding: 12, gap: 8 },
  heroContent: { gap: 6 },
  heroRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  trafficContent: { gap: 8 },
  trafficRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  trafficLabel: { gap: 0 },
  trafficValue: { fontWeight: "600" },
  tileSkeleton: { flexBasis: "48%", flexGrow: 1 },
});
