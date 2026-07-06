import { useMutation, useQuery } from "@connectrpc/connect-query";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Button, HelperText, List, Snackbar, TextInput } from "react-native-paper";
import Constants from "expo-constants";

import { invalidateRpcQueries } from "@/api/client";
import { useServers } from "@/api/servers";
import { Reveal } from "@/components/reveal";
import { Screen } from "@/components/screen";
import {
  getSettings,
  getUserConfig,
  updateSettings,
} from "@/gen/panel-PanelService_connectquery";

export default function SettingsScreen() {
  const queryClient = useQueryClient();
  const { active, clearActiveToken } = useServers();

  // ---- Panel settings (link port + SNI) ----
  const settings = useQuery(getSettings, {});
  const saveSettings = useMutation(updateSettings);
  const [port, setPort] = useState<string | null>(null);
  const [sni, setSni] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  // Prefill once as the settings land; a refetch must not clobber edits in
  // progress (guarded set-state-in-render, no effect needed).
  if (settings.data && port === null && sni === null) {
    setPort(settings.data.port);
    setSni(settings.data.sni);
  }

  const dirty =
    settings.data != null &&
    port !== null &&
    sni !== null &&
    (port !== settings.data.port || sni !== settings.data.sni);

  const submitSettings = async () => {
    if (port === null || sni === null) return;
    try {
      const res = await saveSettings.mutateAsync({ port: port.trim(), sni: sni.trim() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Port/SNI feed the generated links, so cached share screens go stale.
      invalidateRpcQueries(queryClient, [getSettings, getUserConfig]);
      setPort(res.port);
      setSni(res.sni);
      setNotice("Panel settings saved — affects links issued from now on");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Screen title="Settings">
      <ScrollView contentContainerStyle={styles.content}>
        <List.Section>
          <List.Subheader>Connection links</List.Subheader>
          <View style={styles.fields}>
            <TextInput
              mode="outlined"
              label="Port"
              placeholder="core listen port"
              value={port ?? ""}
              onChangeText={setPort}
              keyboardType="numeric"
              disabled={port === null}
            />
            <TextInput
              mode="outlined"
              label="SNI"
              placeholder="e.g. www.bing.com"
              value={sni ?? ""}
              onChangeText={setSni}
              autoCapitalize="none"
              autoCorrect={false}
              disabled={sni === null}
            />
            <HelperText type="info" visible style={styles.noPad}>
              Feed the hysteria2:// links the panel generates. Changes affect links issued
              afterwards.
            </HelperText>
            {dirty && (
              <Reveal>
                <Button
                  mode="contained"
                  onPress={submitSettings}
                  loading={saveSettings.isPending}
                  disabled={saveSettings.isPending}
                >
                  Save
                </Button>
              </Reveal>
            )}
          </View>
        </List.Section>

        <List.Section>
          <List.Subheader>This app</List.Subheader>
          <List.Item
            title={active?.name ?? "No server"}
            description={active?.url}
            left={(p) => <List.Icon {...p} icon="server" />}
            onPress={() => router.push("/manage-servers")}
          />
          <List.Item
            title="Sign out"
            description="Forget this server's token on this device"
            left={(p) => <List.Icon {...p} icon="logout" />}
            onPress={() => void clearActiveToken()}
          />
          <List.Item
            title="Version"
            description={Constants.expoConfig?.version ?? "dev"}
            left={(p) => <List.Icon {...p} icon="information-outline" />}
          />
        </List.Section>
      </ScrollView>

      <Snackbar visible={!!notice} onDismiss={() => setNotice("")} duration={3500}>
        {notice}
      </Snackbar>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 32 },
  fields: { paddingHorizontal: 16, gap: 8 },
  noPad: { paddingHorizontal: 0 },
});
