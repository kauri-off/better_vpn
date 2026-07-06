import { useQuery } from "@connectrpc/connect-query";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, Share, StyleSheet, View, useWindowDimensions } from "react-native";
import {
  ActivityIndicator,
  Appbar,
  Button,
  Card,
  Snackbar,
  Text,
  useTheme,
} from "react-native-paper";
import { SvgXml } from "react-native-svg";

import { serverHost, useServers } from "@/api/servers";
import { getUserConfig } from "@/gen/panel-PanelService_connectquery";

export default function ShareScreen() {
  const theme = useTheme();
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = Number(idParam);
  const { active } = useServers();
  const { width } = useWindowDimensions();

  // linkHost mirrors the web panel: connection links point at the host the
  // admin reaches the panel on.
  const config = useQuery(getUserConfig, {
    id,
    linkHost: active ? serverHost(active.url) : "",
  });

  const [notice, setNotice] = useState("");
  const [showToken, setShowToken] = useState(false);

  const copy = async (label: string, value: string) => {
    await Clipboard.setStringAsync(value);
    Haptics.selectionAsync();
    setNotice(`${label} copied`);
  };

  const d = config.data;
  const qrSize = Math.min(width - 96, 320);

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header>
        <Appbar.BackAction onPress={() => router.back()} />
        <Appbar.Content title={d ? `Share · ${d.username}` : "Share"} />
      </Appbar.Header>

      {config.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : config.isError ? (
        <View style={styles.center}>
          <Text style={styles.centerText}>{config.error.message}</Text>
          <Button mode="contained-tonal" onPress={() => config.refetch()}>
            Retry
          </Button>
        </View>
      ) : d ? (
        <ScrollView contentContainerStyle={styles.content}>
          <Card mode="contained">
            <Card.Content style={styles.qrCard}>
              <View style={styles.qrBox}>
                {/* The backend QR is a standalone SVG document; render as-is
                    on a white plate so it scans in dark mode too. */}
                <SvgXml xml={d.qrSvg} width={qrSize} height={qrSize} />
              </View>
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                Scan in a Hysteria2-compatible client
              </Text>
            </Card.Content>
          </Card>

          <Card mode="contained">
            <Card.Content style={styles.linkCard}>
              <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                Connection link
              </Text>
              <Text variant="bodySmall" selectable numberOfLines={4} style={styles.mono}>
                {d.connectionUri}
              </Text>
              <View style={styles.actions}>
                <Button
                  mode="contained"
                  icon="content-copy"
                  onPress={() => copy("Link", d.connectionUri)}
                >
                  Copy
                </Button>
                <Button
                  mode="contained-tonal"
                  icon="share-variant"
                  onPress={() => Share.share({ message: d.connectionUri })}
                >
                  Share
                </Button>
              </View>
            </Card.Content>
          </Card>

          <Card mode="contained">
            <Card.Content style={styles.linkCard}>
              <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                Auth token
              </Text>
              <Text variant="bodySmall" selectable style={styles.mono}>
                {showToken ? d.authToken : "•".repeat(Math.min(d.authToken.length, 24))}
              </Text>
              <View style={styles.actions}>
                <Button mode="text" onPress={() => setShowToken((v) => !v)}>
                  {showToken ? "Hide" : "Reveal"}
                </Button>
                <Button mode="text" icon="content-copy" onPress={() => copy("Token", d.authToken)}>
                  Copy
                </Button>
              </View>
            </Card.Content>
          </Card>
        </ScrollView>
      ) : null}

      <Snackbar visible={!!notice} onDismiss={() => setNotice("")} duration={2500}>
        {notice}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  centerText: { textAlign: "center" },
  content: { padding: 12, gap: 8 },
  qrCard: { alignItems: "center", gap: 8 },
  qrBox: { backgroundColor: "#fff", borderRadius: 12, padding: 12 },
  linkCard: { gap: 8 },
  mono: { fontFamily: "monospace" },
  actions: { flexDirection: "row", gap: 8 },
});
