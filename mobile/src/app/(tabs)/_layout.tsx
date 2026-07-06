import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import type { ColorValue } from "react-native";
import { BottomNavigation } from "react-native-paper";

type McIconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

function iconFor(active: McIconName, inactive: McIconName) {
  const TabIcon = ({ focused, color, size }: { focused: boolean; color: ColorValue; size: number }) => (
    <MaterialCommunityIcons name={focused ? active : inactive} color={color} size={size} />
  );
  TabIcon.displayName = `TabIcon(${active})`;
  return TabIcon;
}

// React Navigation's tab routes carry name/params; Paper's BottomNavigation
// route type doesn't know about them.
type NavRoute = { key: string; name: string; params?: object };

// Paper's MD3 bottom bar in place of the default React Navigation tab bar.
// Props are loosely typed: @react-navigation/bottom-tabs isn't a direct
// dependency under pnpm's strict layout, and this adapter only touches a
// stable subset of them.
function MaterialTabBar({ navigation, state, descriptors, insets }: any) {
  return (
    <BottomNavigation.Bar
      navigationState={state}
      safeAreaInsets={insets}
      onTabPress={({ route, preventDefault }) => {
        const event = navigation.emit({
          type: "tabPress",
          target: route.key,
          canPreventDefault: true,
        });
        if (event.defaultPrevented) preventDefault();
        else {
          const r = route as NavRoute;
          navigation.navigate(r.name, r.params);
        }
      }}
      renderIcon={({ route, focused, color }) =>
        descriptors[route.key].options.tabBarIcon?.({ focused, color, size: 24 }) ?? null
      }
      getLabelText={({ route }) =>
        descriptors[route.key].options.title ?? (route as NavRoute).name
      }
    />
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <MaterialTabBar {...props} />}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Dashboard", tabBarIcon: iconFor("view-dashboard", "view-dashboard-outline") }}
      />
      <Tabs.Screen
        name="users"
        options={{ title: "Users", tabBarIcon: iconFor("account-group", "account-group-outline") }}
      />
      <Tabs.Screen
        name="server"
        options={{ title: "Server", tabBarIcon: iconFor("server", "server-outline") }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: "Settings", tabBarIcon: iconFor("cog", "cog-outline") }}
      />
    </Tabs>
  );
}
