import { useMutation, useQuery } from "@connectrpc/connect-query";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import {
  ActivityIndicator,
  Appbar,
  Button,
  Dialog,
  Divider,
  List,
  Portal,
  Snackbar,
  Switch,
  Text,
  useTheme,
} from "react-native-paper";

import { POLL_MS } from "@/api/client";
import {
  deleteUser,
  getUser,
  kickUser,
  resetUserUsage,
  updateUser,
} from "@/gen/panel-PanelService_connectquery";
import { fmtBytes, fmtRelative, fmtTs } from "@/lib/format";
import { useAppActive } from "@/lib/use-app-active";

type Confirm = "kick" | "reset" | "delete";

export default function UserDetailScreen() {
  const theme = useTheme();
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = Number(idParam);
  const appActive = useAppActive();
  const queryClient = useQueryClient();

  const user = useQuery(getUser, { id }, { refetchInterval: appActive ? POLL_MS : false });

  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [notice, setNotice] = useState("");

  const invalidate = () => queryClient.invalidateQueries();
  const toggle = useMutation(updateUser);
  const kick = useMutation(kickUser);
  const reset = useMutation(resetUserUsage);
  const remove = useMutation(deleteUser);

  const onToggleEnabled = async (enabled: boolean) => {
    try {
      await toggle.mutateAsync({ id, enabled });
      Haptics.selectionAsync();
      invalidate();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };

  const runConfirmed = async () => {
    const action = confirm;
    setConfirm(null);
    try {
      if (action === "kick") {
        await kick.mutateAsync({ id });
        setNotice("Active sessions disconnected");
      } else if (action === "reset") {
        await reset.mutateAsync({ id });
        setNotice("Usage reset to zero");
      } else if (action === "delete") {
        await remove.mutateAsync({ id });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        invalidate();
        router.back();
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      invalidate();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };

  const d = user.data;

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header>
        <Appbar.BackAction onPress={() => router.back()} />
        <Appbar.Content title={d?.username ?? "User"} />
        <Appbar.Action
          icon="pencil"
          onPress={() => router.push({ pathname: "/user/[id]/edit", params: { id } })}
        />
      </Appbar.Header>

      {user.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : user.isError ? (
        <View style={styles.center}>
          <Text style={styles.centerText}>{user.error.message}</Text>
          <Button mode="contained-tonal" onPress={() => user.refetch()}>
            Retry
          </Button>
        </View>
      ) : d ? (
        <ScrollView contentContainerStyle={styles.content}>
          <List.Section>
            <List.Item
              title="Enabled"
              left={(p) => <List.Icon {...p} icon={d.enabled ? "account-check" : "account-off"} />}
              right={() => (
                <Switch
                  value={d.enabled}
                  disabled={toggle.isPending}
                  onValueChange={onToggleEnabled}
                />
              )}
            />
            <List.Item
              title="Usage"
              description={`${fmtBytes(d.usedBytes)}${d.quotaBytes > 0n ? ` of ${fmtBytes(d.quotaBytes)}` : " (no quota)"}`}
              left={(p) => <List.Icon {...p} icon="chart-donut" />}
            />
            <List.Item
              title="Online connections"
              description={d.connections > 0 ? `${d.connections} device(s)` : "offline"}
              left={(p) => <List.Icon {...p} icon="devices" />}
            />
            <List.Item
              title="Expires"
              description={d.expiresAt > 0n ? `${fmtTs(d.expiresAt)} (${fmtRelative(d.expiresAt)})` : "never"}
              left={(p) => <List.Icon {...p} icon="calendar-clock" />}
            />
            <List.Item
              title="Last seen"
              description={d.lastSeen > 0n ? fmtRelative(d.lastSeen) : "never"}
              left={(p) => <List.Icon {...p} icon="eye-outline" />}
            />
            <List.Item
              title="Created"
              description={fmtTs(d.createdAt)}
              left={(p) => <List.Icon {...p} icon="calendar-plus" />}
            />
            {!!d.note && (
              <List.Item
                title="Note"
                description={d.note}
                descriptionNumberOfLines={4}
                left={(p) => <List.Icon {...p} icon="note-text-outline" />}
              />
            )}
          </List.Section>

          <Divider />

          <List.Section>
            <List.Item
              title="Share connection"
              description="QR code, link and token"
              left={(p) => <List.Icon {...p} icon="qrcode" />}
              onPress={() => router.push({ pathname: "/user/[id]/share", params: { id } })}
            />
            <List.Item
              title="Kick"
              description="Force-disconnect active sessions"
              left={(p) => <List.Icon {...p} icon="connection" />}
              onPress={() => setConfirm("kick")}
            />
            <List.Item
              title="Reset usage"
              description="Set the accumulated usage counter to zero"
              left={(p) => <List.Icon {...p} icon="restore" />}
              onPress={() => setConfirm("reset")}
            />
            <List.Item
              title="Delete user"
              titleStyle={{ color: theme.colors.error }}
              left={(p) => <List.Icon {...p} icon="delete-outline" color={theme.colors.error} />}
              onPress={() => setConfirm("delete")}
            />
          </List.Section>
        </ScrollView>
      ) : null}

      <Portal>
        <Dialog visible={confirm !== null} onDismiss={() => setConfirm(null)}>
          <Dialog.Title>
            {confirm === "kick" ? "Kick user?" : confirm === "reset" ? "Reset usage?" : "Delete user?"}
          </Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              {confirm === "kick"
                ? `Force-disconnects ${d?.username}'s active sessions. They can reconnect immediately.`
                : confirm === "reset"
                  ? `Resets ${d?.username}'s accumulated usage counter to zero.`
                  : `Permanently removes ${d?.username} and their credential. This cannot be undone.`}
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirm(null)}>Cancel</Button>
            <Button
              textColor={confirm === "delete" ? theme.colors.error : undefined}
              onPress={runConfirmed}
            >
              {confirm === "kick" ? "Kick" : confirm === "reset" ? "Reset" : "Delete"}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar visible={!!notice} onDismiss={() => setNotice("")} duration={3000}>
        {notice}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  centerText: { textAlign: "center" },
  content: { paddingBottom: 24 },
});
