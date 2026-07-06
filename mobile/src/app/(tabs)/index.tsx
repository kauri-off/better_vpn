import { useMutation, useQuery } from "@connectrpc/connect-query";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import {
  ActivityIndicator,
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

import { POLL_MS } from "@/api/client";
import { useServers } from "@/api/servers";
import { Screen } from "@/components/screen";
import { Sparkline } from "@/components/sparkline";
import { StatGrid, StatTile } from "@/components/stat-tile";
import {
  getServerStats,
  restartCore,
  updateCore,
} from "@/gen/panel-PanelService_connectquery";
import { fmtBytes, fmtDuration, fmtRate } from "@/lib/format";
import { useAppActive } from "@/lib/use-app-active";

const HISTORY = 24; // sparkline window: 24 samples ≈ 72s at the 3s poll

export default function DashboardScreen() {
  const theme = useTheme();
  const { active } = useServers();
  const appActive = useAppActive();
  const stats = useQuery(getServerStats, {}, { refetchInterval: appActive ? POLL_MS : false });

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

  // Rolling rate history for the traffic sparklines.
  const historyRef = useRef<{ rx: number[]; tx: number[] }>({ rx: [], tx: [] });
  const [, bump] = useState(0);
  useEffect(() => {
    if (!stats.data) return;
    const h = historyRef.current;
    h.rx = [...h.rx, Number(stats.data.netRxRate)].slice(-HISTORY);
    h.tx = [...h.tx, Number(stats.data.netTxRate)].slice(-HISTORY);
    bump((n) => n + 1);
  }, [stats.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
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
              <TrafficRow label="Download" rate={Number(d.netRxRate)} history={historyRef.current.rx} />
              <TrafficRow label="Upload" rate={Number(d.netTxRate)} history={historyRef.current.tx} />
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
  return (
    <View style={styles.trafficRow}>
      <View style={styles.trafficLabel}>
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
          {label}
        </Text>
        <Text variant="titleMedium" style={styles.trafficValue}>
          {fmtRate(rate)}
        </Text>
      </View>
      <Sparkline values={history} width={120} height={32} />
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
});
