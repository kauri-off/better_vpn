// Server list + add-server screen body, mounted as two routes: /servers (the
// login surface, only available while signed out — when the auth guard flips,
// expo-router auto-redirects into the tabs) and /manage-servers (reachable
// from Settings while signed in). Adding a server validates the URL + token
// with an unauthenticated Login RPC before anything is persisted.
import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import {
  Appbar,
  Button,
  Dialog,
  Divider,
  HelperText,
  List,
  Portal,
  Text,
  TextInput,
  useTheme,
} from "react-native-paper";
import * as SecureStore from "expo-secure-store";

import { probeClient } from "@/api/client";
import { normalizeApiUrl, useServers, type PanelServer } from "@/api/servers";
import { ConnectError, Code } from "@connectrpc/connect";

function loginErrorMessage(err: unknown): string {
  if (err instanceof ConnectError) {
    if (err.code === Code.Unauthenticated) return "Invalid access token";
    if (err.code === Code.ResourceExhausted) return "Too many attempts — try again shortly";
    return `Connection failed: ${err.rawMessage || err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export default function ServersScreen() {
  const theme = useTheme();
  const { servers, active, activeToken, addServer, removeServer, setActive, setServerToken } =
    useServers();

  // Add-server form
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Re-enter token dialog (saved server whose token is missing/rejected)
  const [tokenFor, setTokenFor] = useState<PanelServer | null>(null);
  const [dialogToken, setDialogToken] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [dialogBusy, setDialogBusy] = useState(false);

  // Delete confirmation
  const [deleteFor, setDeleteFor] = useState<PanelServer | null>(null);

  const authed = !!active && !!activeToken;

  const connect = async () => {
    setError("");
    setBusy(true);
    try {
      const normalized = normalizeApiUrl(url);
      await probeClient(normalized).login({ token: token.trim() });
      await addServer({ name, url: normalized, token: token.trim() });
      setName("");
      setUrl("");
      setToken("");
      // On the login route the guard flip redirects into the tabs by itself;
      // on the manage route go back explicitly (switching servers rebuilds
      // the transport underneath the tabs).
      if (router.canGoBack()) router.back();
    } catch (err) {
      setError(loginErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const selectServer = async (server: PanelServer) => {
    const stored = await SecureStore.getItemAsync(`panel_token_${server.id}`);
    if (!stored) {
      setDialogToken("");
      setDialogError("");
      setTokenFor(server);
      return;
    }
    await setActive(server.id);
    if (router.canGoBack()) router.back();
  };
  // (both flows above rely on the guard redirect when this is the login route)

  const submitDialogToken = async () => {
    if (!tokenFor) return;
    setDialogError("");
    setDialogBusy(true);
    try {
      await probeClient(tokenFor.url).login({ token: dialogToken.trim() });
      await setServerToken(tokenFor.id, dialogToken.trim());
      await setActive(tokenFor.id);
      setTokenFor(null);
      if (router.canGoBack()) router.back();
    } catch (err) {
      setDialogError(loginErrorMessage(err));
    } finally {
      setDialogBusy(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header>
        {router.canGoBack() && authed ? <Appbar.BackAction onPress={() => router.back()} /> : null}
        <Appbar.Content title="Servers" />
      </Appbar.Header>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {servers.length > 0 && (
            <>
              <List.Section>
                {servers.map((s) => (
                  <List.Item
                    key={s.id}
                    title={s.name}
                    description={s.url}
                    left={(p) => (
                      <List.Icon
                        {...p}
                        icon={s.id === active?.id ? "server" : "server-outline"}
                        color={s.id === active?.id ? theme.colors.primary : undefined}
                      />
                    )}
                    right={(p) => (
                      <Appbar.Action
                        {...p}
                        icon="delete-outline"
                        size={20}
                        onPress={() => setDeleteFor(s)}
                      />
                    )}
                    onPress={() => selectServer(s)}
                  />
                ))}
              </List.Section>
              <Divider />
            </>
          )}

          <Text variant="titleMedium" style={styles.addTitle}>
            Add server
          </Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            Enter the panel URL you browse to (e.g. 192.168.1.98/panel) and its admin access
            token.
          </Text>
          <TextInput
            label="Name (optional)"
            value={name}
            onChangeText={setName}
            mode="outlined"
            autoCapitalize="none"
            style={styles.field}
          />
          <TextInput
            label="Panel URL"
            value={url}
            onChangeText={setUrl}
            mode="outlined"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="http://host/panel"
            style={styles.field}
          />
          <TextInput
            label="Access token"
            value={token}
            onChangeText={setToken}
            mode="outlined"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={styles.field}
          />
          {!!error && (
            <HelperText type="error" visible>
              {error}
            </HelperText>
          )}
          <Button
            mode="contained"
            onPress={connect}
            loading={busy}
            disabled={busy || !url.trim() || !token.trim()}
            style={styles.connect}
          >
            Connect
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>

      <Portal>
        <Dialog visible={!!tokenFor} onDismiss={() => setTokenFor(null)}>
          <Dialog.Title>Access token</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={styles.dialogHint}>
              Enter the admin token for {tokenFor?.name}.
            </Text>
            <TextInput
              label="Access token"
              value={dialogToken}
              onChangeText={setDialogToken}
              mode="outlined"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            {!!dialogError && (
              <HelperText type="error" visible>
                {dialogError}
              </HelperText>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setTokenFor(null)}>Cancel</Button>
            <Button
              onPress={submitDialogToken}
              loading={dialogBusy}
              disabled={dialogBusy || !dialogToken.trim()}
            >
              Connect
            </Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog visible={!!deleteFor} onDismiss={() => setDeleteFor(null)}>
          <Dialog.Title>Remove server?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              {deleteFor?.name} and its stored token will be removed from this device.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDeleteFor(null)}>Cancel</Button>
            <Button
              textColor={theme.colors.error}
              onPress={async () => {
                if (deleteFor) await removeServer(deleteFor.id);
                setDeleteFor(null);
              }}
            >
              Remove
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, gap: 4 },
  addTitle: { marginTop: 12 },
  field: { marginTop: 12 },
  connect: { marginTop: 16 },
  dialogHint: { marginBottom: 12 },
});
