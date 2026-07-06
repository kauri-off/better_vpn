import { useMutation } from "@connectrpc/connect-query";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import {
  Appbar,
  Button,
  HelperText,
  List,
  Switch,
  TextInput,
  useTheme,
} from "react-native-paper";

import { invalidateRpcQueries } from "@/api/client";
import { serverHost, useServers } from "@/api/servers";
import { ExpiryField, QuotaField } from "@/components/user-form-fields";
import {
  createUser,
  getServerStats,
  listUsers,
} from "@/gen/panel-PanelService_connectquery";
import { quotaToBytes, type QuotaUnit } from "@/lib/quota";

export default function NewUserScreen() {
  const theme = useTheme();
  const { active } = useServers();
  const queryClient = useQueryClient();
  const create = useMutation(createUser);

  const [username, setUsername] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [expiresAt, setExpiresAt] = useState(0);
  const [quota, setQuota] = useState<{ value: string; unit: QuotaUnit; unlimited: boolean }>({
    value: "",
    unit: "GB",
    unlimited: true,
  });
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    try {
      const res = await create.mutateAsync({
        username: username.trim(),
        enabled,
        expiresAt: BigInt(expiresAt),
        quotaBytes: quota.unlimited ? 0n : quotaToBytes(quota.value, quota.unit),
        note: note.trim(),
        linkHost: active ? serverHost(active.url) : "",
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      invalidateRpcQueries(queryClient, [listUsers, getServerStats]);
      // Straight to the share screen for the new credential; replace so back
      // returns to the users list, not this form.
      router.replace({ pathname: "/user/[id]/share", params: { id: res.user?.id ?? 0 } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header>
        <Appbar.BackAction onPress={() => router.back()} />
        <Appbar.Content title="New user" />
      </Appbar.Header>
      <KeyboardAvoidingView style={styles.root} behavior="padding">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <TextInput
            mode="outlined"
            label="Username"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.field}
          />
          <List.Item
            title="Enabled"
            left={(p) => <List.Icon {...p} icon="account-check" />}
            right={() => <Switch value={enabled} onValueChange={setEnabled} />}
          />
          <ExpiryField value={expiresAt} onChange={setExpiresAt} />
          <QuotaField {...quota} onChange={setQuota} />
          <TextInput
            mode="outlined"
            label="Note (optional)"
            value={note}
            onChangeText={setNote}
            multiline
            numberOfLines={3}
            style={styles.field}
          />
          {!!error && (
            <HelperText type="error" visible>
              {error}
            </HelperText>
          )}
          <Button
            mode="contained"
            onPress={submit}
            loading={create.isPending}
            disabled={create.isPending || !username.trim()}
            style={styles.submit}
          >
            Create user
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  field: { marginBottom: 8 },
  submit: { marginTop: 16 },
});
