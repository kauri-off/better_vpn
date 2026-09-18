import { StyleSheet, View } from "react-native";
import { Icon, Text, useTheme } from "react-native-paper";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

// Shown above stale content while a polling query keeps failing, instead of
// replacing the last known data with an error screen.
export function OfflineBanner({ visible, message }: { visible: boolean; message?: string }) {
  const theme = useTheme();
  if (!visible) return null;
  return (
    <Animated.View
      entering={FadeIn.duration(150)}
      exiting={FadeOut.duration(150)}
      style={[styles.root, { backgroundColor: theme.colors.errorContainer }]}
    >
      <Icon source="cloud-off-outline" size={18} color={theme.colors.onErrorContainer} />
      <View style={styles.body}>
        <Text variant="labelLarge" style={{ color: theme.colors.onErrorContainer }}>
          Connection lost — showing last known data
        </Text>
        {!!message && (
          <Text variant="bodySmall" numberOfLines={1} style={{ color: theme.colors.onErrorContainer }}>
            {message}
          </Text>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  body: { flex: 1 },
});
