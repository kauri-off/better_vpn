import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useTheme } from "react-native-paper";

// Platform bottom navigation (Material 3 on Android) instead of a JS tab bar:
// native ripple, indicator animation and predictive-back integration.
export default function TabLayout() {
  const theme = useTheme();
  return (
    <NativeTabs
      labelVisibilityMode="labeled"
      backgroundColor={theme.colors.elevation.level2}
      indicatorColor={theme.colors.secondaryContainer}
      rippleColor={theme.colors.secondaryContainer}
      iconColor={{
        default: theme.colors.onSurfaceVariant,
        selected: theme.colors.onSecondaryContainer,
      }}
      labelStyle={{
        default: { color: theme.colors.onSurfaceVariant },
        selected: { color: theme.colors.onSurface },
      }}
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Dashboard</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon md="dashboard" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="users">
        <NativeTabs.Trigger.Label>Users</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon md="group" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="server">
        <NativeTabs.Trigger.Label>Server</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon md="dns" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon md="settings" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
