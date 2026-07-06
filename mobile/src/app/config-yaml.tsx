// Raw Hysteria config.yaml editor — the escape hatch for anything the
// structured form doesn't model. The backend validates before swapping.
import { useMutation, useQuery } from "@connectrpc/connect-query";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import {
  ActivityIndicator,
  Appbar,
  Button,
  Dialog,
  Portal,
  Snackbar,
  Text,
  TextInput,
  useTheme,
} from "react-native-paper";

import { getConfig, updateRawConfig } from "@/gen/panel-PanelService_connectquery";

export default function ConfigYamlScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const config = useQuery(getConfig, {});
  const save = useMutation(updateRawConfig);

  const [yaml, setYaml] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (config.data && yaml === null) setYaml(config.data.rawYaml);
  }, [config.data, yaml]);

  const dirty = yaml !== null && yaml !== config.data?.rawYaml;

  const submit = async () => {
    setConfirm(false);
    if (yaml === null) return;
    try {
      const res = await save.mutateAsync({ rawYaml: yaml });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries();
      setYaml(res.rawYaml);
      setNotice("Config saved — restart the core to apply");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header>
        <Appbar.BackAction onPress={() => router.back()} />
        <Appbar.Content title="Raw config.yaml" />
        <Appbar.Action
          icon="content-save"
          disabled={!dirty || save.isPending}
          onPress={() => setConfirm(true)}
        />
      </Appbar.Header>
      {yaml === null ? (
        <View style={styles.center}>
          {config.isError ? (
            <>
              <Text style={styles.centerText}>{config.error.message}</Text>
              <Button mode="contained-tonal" onPress={() => config.refetch()}>
                Retry
              </Button>
            </>
          ) : (
            <ActivityIndicator />
          )}
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.root}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <TextInput
              mode="outlined"
              value={yaml}
              onChangeText={setYaml}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              style={styles.editor}
              contentStyle={styles.editorContent}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      <Portal>
        <Dialog visible={confirm} onDismiss={() => setConfirm(false)}>
          <Dialog.Title>Replace config.yaml?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              The YAML is validated before the swap; panel-managed auth/trafficStats blocks are
              reasserted if changed. A core restart is needed to apply.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirm(false)}>Cancel</Button>
            <Button onPress={submit}>Save</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar visible={!!notice} onDismiss={() => setNotice("")} duration={4000}>
        {notice}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  centerText: { textAlign: "center" },
  content: { padding: 12, paddingBottom: 32 },
  editor: { minHeight: 400 },
  editorContent: { fontFamily: "monospace", fontSize: 13 },
});
