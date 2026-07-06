import { useQuery } from "@connectrpc/connect-query";
import { FlashList } from "@shopify/flash-list";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import {
  Avatar,
  Badge,
  Button,
  FAB,
  ProgressBar,
  Searchbar,
  Text,
  TouchableRipple,
  useTheme,
} from "react-native-paper";
import Animated, { FadeIn } from "react-native-reanimated";

import { POLL_MS } from "@/api/client";
import { Screen } from "@/components/screen";
import { Skeleton } from "@/components/skeleton";
import { listUsers } from "@/gen/panel-PanelService_connectquery";
import type { VpnUser } from "@/gen/panel_pb";
import { fmtBytes, fmtRelative } from "@/lib/format";

// The panel is a single-admin tool for modest fleets; one page of 500 covers
// it while keeping the search server-side (same shortcut the SSH console takes).
const PAGE_SIZE = 500;

// Keystroke → RPC debounce for the server-side search.
const SEARCH_DEBOUNCE_MS = 250;

export default function UsersScreen() {
  const theme = useTheme();
  const [search, setSearch] = useState("");
  // The query follows the input after a pause, so typing doesn't fire one
  // listUsers RPC per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);
  // Polling pauses in the background via the focusManager wiring in api/client.
  const users = useQuery(
    listUsers,
    { search: debouncedSearch, limit: PAGE_SIZE, offset: 0 },
    { refetchInterval: POLL_MS, placeholderData: (prev) => prev },
  );

  // Pull-to-refresh spinner is driven by the gesture only — binding it to
  // isRefetching would flash it on every background poll tick.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await users.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Screen title="Users">
      <View style={styles.searchWrap}>
        <Searchbar
          placeholder="Search users"
          value={search}
          onChangeText={setSearch}
          mode="bar"
        />
      </View>
      {users.isPending ? (
        <UsersSkeleton />
      ) : users.isError ? (
        <View style={styles.center}>
          <Text style={styles.centerText}>{users.error.message}</Text>
          <Button mode="contained-tonal" onPress={() => users.refetch()}>
            Retry
          </Button>
        </View>
      ) : users.data.users.length === 0 ? (
        <View style={styles.center}>
          <Text style={{ color: theme.colors.onSurfaceVariant }}>
            {search ? "No users match the search" : "No users yet — add the first one"}
          </Text>
        </View>
      ) : (
        <FlashList
          data={users.data.users}
          keyExtractor={(u) => String(u.id)}
          renderItem={({ item }) => <UserRow user={item} now={users.dataUpdatedAt} />}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        />
      )}
      <FAB icon="plus" style={styles.fab} onPress={() => router.push("/user/new")} />
    </Screen>
  );
}

// Mirrors UserRow's layout (avatar + two text lines) during the initial load.
function UsersSkeleton() {
  return (
    <View>
      {Array.from({ length: 8 }, (_, i) => (
        <View key={i} style={styles.row}>
          <Skeleton width={40} height={40} radius={20} />
          <View style={[styles.rowBody, styles.rowBodySkeleton]}>
            <Skeleton width="55%" height={16} />
            <Skeleton width="80%" height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}

// `now` is the query's dataUpdatedAt: at most one poll tick stale, and keeps
// render pure (no Date.now() during render).
function UserRow({ user, now }: { user: VpnUser; now: number }) {
  const theme = useTheme();
  const online = user.connections > 0;
  const expired = user.expiresAt > 0n && Number(user.expiresAt) * 1000 < now;
  const overQuota = user.quotaBytes > 0n && user.usedBytes >= user.quotaBytes;
  const usage = user.quotaBytes > 0n ? Number(user.usedBytes) / Number(user.quotaBytes) : 0;

  const status = !user.enabled
    ? "disabled"
    : expired
      ? `expired ${fmtRelative(user.expiresAt).replace(" ago", "")} ago`
      : user.expiresAt > 0n
        ? `expires ${fmtRelative(user.expiresAt)}`
        : "no expiry";

  return (
    <TouchableRipple
      onPress={() => router.push({ pathname: "/user/[id]", params: { id: user.id } })}
    >
      <Animated.View
        entering={FadeIn.duration(150)}
        style={[styles.row, !user.enabled && styles.rowDisabled]}
      >
        <View>
          <Avatar.Text size={40} label={user.username.slice(0, 2).toUpperCase()} />
          {online && (
            <Badge size={14} style={[styles.onlineDot, { backgroundColor: "#2e7d32" }]}>
              {user.connections}
            </Badge>
          )}
        </View>
        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <Text variant="titleMedium" numberOfLines={1} style={styles.rowName}>
              {user.username}
            </Text>
            <Text
              variant="bodySmall"
              style={{ color: expired || overQuota ? theme.colors.error : theme.colors.onSurfaceVariant }}
            >
              {status}
            </Text>
          </View>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {fmtBytes(user.usedBytes)}
            {user.quotaBytes > 0n ? ` of ${fmtBytes(user.quotaBytes)}` : ""}
            {user.lastSeen > 0n ? ` · seen ${fmtRelative(user.lastSeen)}` : ""}
          </Text>
          {user.quotaBytes > 0n && (
            <ProgressBar
              progress={Math.min(usage, 1)}
              color={overQuota ? theme.colors.error : theme.colors.primary}
              style={styles.usageBar}
            />
          )}
        </View>
      </Animated.View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  searchWrap: { paddingHorizontal: 12, paddingBottom: 8 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  centerText: { textAlign: "center" },
  listContent: { paddingBottom: 96 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  rowDisabled: { opacity: 0.45 },
  rowBody: { flex: 1, gap: 2 },
  rowBodySkeleton: { gap: 6 },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  rowName: { flexShrink: 1 },
  onlineDot: { position: "absolute", right: -2, top: -2 },
  usageBar: { height: 4, borderRadius: 2, marginTop: 2 },
  fab: { position: "absolute", right: 16, bottom: 16 },
});
