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

  const settings = useQuery(getSettings, {});
  const saveSettings = useMutation(updateSettings);
  const [sni, setSni] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  // Prefill once; a refetch must not clobber edits in progress.
  if (settings.data && sni === null) {
    setSni(settings.data.sni);
  }

  const dirty = settings.data != null && sni !== null && sni !== settings.data.sni;

  const submitSettings = async () => {
    if (!settings.data || sni === null) return;
    try {
      const res = await saveSettings.mutateAsync({ ...settings.data, sni: sni.trim() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      invalidateRpcQueries(queryClient, [getSettings, getUserConfig]);
      setSni(res.sni);
      setNotice("Saved — affects links issued from now on");
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
              label="SNI"
              placeholder="e.g. www.bing.com"
              value={sni ?? ""}
              onChangeText={setSni}
              autoCapitalize="none"
              autoCorrect={false}
              disabled={sni === null}
            />
            <HelperText type="info" visible style={styles.noPad}>
              Hostname clients present for camouflage. The port comes from the server config.
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
