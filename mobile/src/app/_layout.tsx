import "@/polyfills";

import { Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { useColorScheme } from "react-native";
import { PaperProvider } from "react-native-paper";
import { en, registerTranslation } from "react-native-paper-dates";

import { PanelConnectProvider } from "@/api/client";
import { ServersProvider, useServers } from "@/api/servers";
import { navDark, navLight, paperDark, paperLight } from "@/lib/theme";

registerTranslation("en", en);

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { ready, active, activeToken } = useServers();
  const authed = !!active && !!activeToken;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;

  // The guards do the navigation: signing in makes /servers unavailable and
  // expo-router redirects into (tabs); signing out does the reverse.
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={authed}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="user/new" options={{ presentation: "modal" }} />
        <Stack.Screen name="user/[id]/index" />
        <Stack.Screen name="user/[id]/edit" />
        <Stack.Screen name="user/[id]/share" />
        <Stack.Screen name="config-yaml" />
        <Stack.Screen name="manage-servers" />
      </Stack.Protected>
      <Stack.Protected guard={!authed}>
        <Stack.Screen name="servers" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const scheme = useColorScheme();
  const dark = scheme === "dark";
  return (
    <ServersProvider>
      <PanelConnectProvider>
        <PaperProvider theme={dark ? paperDark : paperLight}>
          <ThemeProvider value={dark ? navDark : navLight}>
            <StatusBar style="auto" />
            <RootNavigator />
          </ThemeProvider>
        </PaperProvider>
      </PanelConnectProvider>
    </ServersProvider>
  );
}
