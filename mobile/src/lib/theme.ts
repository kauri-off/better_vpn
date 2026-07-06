import { DarkTheme as NavDark, DefaultTheme as NavLight } from "expo-router";
import { MD3DarkTheme, MD3LightTheme, type MD3Theme } from "react-native-paper";

// App-wide color override: MD3's stock baseline is pastel lavender (primary
// #D0BCFF & friends), which reads washed-out. This swaps the accent roles for
// a saturated blue (anchored on the #208AEF splash color) and drops the purple
// tint from dark surfaces, keeping everything else (typography, error roles,
// state layers) from the stock themes.

export const paperDark: MD3Theme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: "#2E90FA",
    onPrimary: "#FFFFFF",
    primaryContainer: "#0B4A8F",
    onPrimaryContainer: "#D6E9FF",
    inversePrimary: "#0967D2",
    secondary: "#61AEFF",
    onSecondary: "#00325C",
    secondaryContainer: "#12467C",
    onSecondaryContainer: "#D3E8FF",
    tertiary: "#37B5A8",
    onTertiary: "#00332E",
    tertiaryContainer: "#0E4F48",
    onTertiaryContainer: "#BFF2EA",
    background: "#0F1417",
    onBackground: "#E2E6EA",
    surface: "#0F1417",
    onSurface: "#E2E6EA",
    surfaceVariant: "#1D242B",
    onSurfaceVariant: "#BAC4CE",
    surfaceDisabled: "rgba(226, 230, 234, 0.12)",
    onSurfaceDisabled: "rgba(226, 230, 234, 0.38)",
    inverseSurface: "#E2E6EA",
    inverseOnSurface: "#272C30",
    outline: "#77828C",
    outlineVariant: "#2E3840",
    elevation: {
      level0: "transparent",
      level1: "#161C21",
      level2: "#1A2127",
      level3: "#1E262D",
      level4: "#202830",
      level5: "#232C35",
    },
  },
};

export const paperLight: MD3Theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: "#0967D2",
    onPrimary: "#FFFFFF",
    primaryContainer: "#B7D9FF",
    onPrimaryContainer: "#03294F",
    inversePrimary: "#2E90FA",
    secondary: "#12467C",
    onSecondary: "#FFFFFF",
    secondaryContainer: "#C4E0FF",
    onSecondaryContainer: "#0A2A4C",
    tertiary: "#0E6E63",
    onTertiary: "#FFFFFF",
    tertiaryContainer: "#B0EFE5",
    onTertiaryContainer: "#00332E",
    background: "#F8FAFC",
    onBackground: "#191C1F",
    surface: "#F8FAFC",
    onSurface: "#191C1F",
    surfaceVariant: "#E1E8EF",
    onSurfaceVariant: "#42474E",
    surfaceDisabled: "rgba(25, 28, 31, 0.12)",
    onSurfaceDisabled: "rgba(25, 28, 31, 0.38)",
    inverseSurface: "#2D3135",
    inverseOnSurface: "#EFF2F5",
    outline: "#72787F",
    outlineVariant: "#C2C8CF",
    elevation: {
      level0: "transparent",
      level1: "#F0F4F9",
      level2: "#EAF0F6",
      level3: "#E4EBF3",
      level4: "#E1E9F2",
      level5: "#DDE6F0",
    },
  },
};

// Matching React Navigation themes so screen backgrounds and transitions
// don't flash a different color than the Paper surfaces. expo-router doesn't
// re-export the Theme type, so it's derived from the stock theme value.
type NavTheme = typeof NavDark;

export const navDark: NavTheme = {
  ...NavDark,
  colors: {
    ...NavDark.colors,
    primary: paperDark.colors.primary,
    background: paperDark.colors.background,
    card: paperDark.colors.elevation.level2,
    text: paperDark.colors.onSurface,
    border: paperDark.colors.outlineVariant,
    notification: paperDark.colors.error,
  },
};

export const navLight: NavTheme = {
  ...NavLight,
  colors: {
    ...NavLight.colors,
    primary: paperLight.colors.primary,
    background: paperLight.colors.background,
    card: paperLight.colors.surface,
    text: paperLight.colors.onSurface,
    border: paperLight.colors.outlineVariant,
    notification: paperLight.colors.error,
  },
};
