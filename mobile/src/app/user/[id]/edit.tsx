import { useMutation, useQuery } from "@connectrpc/connect-query";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import {
  ActivityIndicator,
  Appbar,
  Button,
  HelperText,
  TextInput,
  useTheme,
} from "react-native-paper";

import { ExpiryField, QuotaField } from "@/components/user-form-fields";
import { getUser, updateUser } from "@/gen/panel-PanelService_connectquery";
import { bytesToQuota, quotaToBytes, type QuotaUnit } from "@/lib/quota";

export default function EditUserScreen() {
  const theme = useTheme();
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = Number(idParam);
  const queryClient = useQueryClient();

  const user = useQuery(getUser, { id });
  const save = useMutation(updateUser);

  const [loaded, setLoaded] = useState(false);
  const [expiresAt, setExpiresAt] = useState(0);
  const [quota, setQuota] = useState<{ value: string; unit: QuotaUnit; unlimited: boolean }>({
    value: "",
    unit: "GB",
    unlimited: true,
  });
  const [note, setNote] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");

  // Prefill once from the fetched user; later poll updates must not stomp
  // in-progress edits.
  useEffect(() => {
    if (!user.data || loaded) return;
    setExpiresAt(Number(user.data.expiresAt));
    const q = bytesToQuota(user.data.quotaBytes);
    setQuota({ ...q, unlimited: user.data.quotaBytes <= 0n });
    setNote(user.data.note);
    setToken(user.data.token);
    setLoaded(true);
  }, [user.data, loaded]);

  const submit = async () => {
    setError("");
    try {
      const tokenChanged = token.trim() !== user.data?.token;
      if (tokenChanged && !token.trim()) {
        setError("Token cannot be empty");
        return;
      }
      await save.mutateAsync({
        id,
        expiresAt: BigInt(expiresAt),
        quotaBytes: quota.unlimited ? 0n : quotaToBytes(quota.value, quota.unit),
        note,
        ...(tokenChanged ? { token: token.trim() } : {}),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries();
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header>
        <Appbar.BackAction onPress={() => router.back()} />
        <Appbar.Content title={user.data ? `Edit · ${user.data.username}` : "Edit user"} />
      </Appbar.Header>
      {!loaded ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.root}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <ExpiryField value={expiresAt} onChange={setExpiresAt} />
            <QuotaField {...quota} onChange={setQuota} />
            <TextInput
              mode="outlined"
              label="Auth token"
              value={token}
              onChangeText={setToken}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.field}
            />
            <HelperText type="info" visible>
              Changing the token invalidates the user's current connection link.
            </HelperText>
            <TextInput
              mode="outlined"
              label="Note"
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
              loading={save.isPending}
              disabled={save.isPending}
              style={styles.submit}
            >
              Save
            </Button>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, paddingBottom: 32 },
  field: { marginBottom: 8, marginTop: 8 },
  submit: { marginTop: 16 },
});
