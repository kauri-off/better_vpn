import { useEffect } from "react";
import type { DimensionValue, StyleProp, ViewStyle } from "react-native";
import { useTheme } from "react-native-paper";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

// Loading placeholder: a rounded rect in the surface-variant tone with a slow
// opacity pulse. Screens compose these to mirror their real layout so content
// pops in without a layout shift.
export function Skeleton({
  width,
  height,
  radius = 8,
  style,
}: {
  width?: DimensionValue;
  height: DimensionValue;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const pulse = useSharedValue(0.55);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 700 }), -1, true);
  }, [pulse]);
  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius, backgroundColor: theme.colors.surfaceVariant },
        animated,
        style,
      ]}
    />
  );
}
