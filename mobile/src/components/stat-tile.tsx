import { StyleSheet, View } from "react-native";
import { Card, Text, useTheme } from "react-native-paper";

// 2-per-row dashboard stat tile: label in muted ink, value in semibold, an
// optional secondary line under the value.
export function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const theme = useTheme();
  return (
    <Card mode="contained" style={styles.card}>
      <Card.Content style={styles.content}>
        <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
          {label}
        </Text>
        <Text variant="titleLarge" style={styles.value}>
          {value}
        </Text>
        {sub != null && (
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {sub}
          </Text>
        )}
      </Card.Content>
    </Card>
  );
}

export function StatGrid({ children }: { children: React.ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  // Two per row regardless of content width.
  card: { flexBasis: "48%", flexGrow: 1 },
  content: { paddingVertical: 12, gap: 2 },
  value: { fontWeight: "600" },
});
