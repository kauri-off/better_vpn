import { useEffect, useMemo } from "react";
import { View } from "react-native";
import { useTheme } from "react-native-paper";
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Polyline } from "react-native-svg";

const AnimatedPolyline = Animated.createAnimatedComponent(Polyline);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const MORPH_MS = 350; // eases each 3s poll sample in instead of snapping

// Stat-tile trend sparkline: the history line rides in a de-emphasis hue and
// only the current sample wears the accent (with a surface ring so it stays
// legible on top of the line). Identity comes from the row's text label, so
// there is no legend and the line color carries no meaning. New samples morph
// the line on the UI thread via animated SVG props.
export function Sparkline({
  values,
  width = 96,
  height = 28,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  const theme = useTheme();
  const pad = 5; // room for the end dot + its ring

  // Normalized y per sample; x is derived from the index in the worklet.
  const ys = useMemo(() => {
    const max = Math.max(...values, 1);
    return values.map((v) => height - pad - (v / max) * (height - pad * 2));
  }, [values, height]);

  const fromYs = useSharedValue<number[]>([]);
  const toYs = useSharedValue<number[]>([]);
  const progress = useSharedValue(1);
  useEffect(() => {
    fromYs.value = toYs.value.length ? toYs.value : ys;
    toYs.value = ys;
    progress.value = 0;
    progress.value = withTiming(1, { duration: MORPH_MS });
  }, [ys, fromYs, toYs, progress]);

  // y at index i, interpolated between the previous and current sample set.
  // While the window is still filling, the sets differ in length; clamping the
  // index into the shorter set keeps the morph defined.
  const yAt = (i: number): number => {
    "worklet";
    const to = toYs.value;
    const from = fromYs.value;
    const start = from.length ? from[Math.min(i, from.length - 1)] : to[i];
    return start + (to[i] - start) * progress.value;
  };

  const lineProps = useAnimatedProps(() => {
    const to = toYs.value;
    if (to.length < 2) return { points: "" };
    const pts: string[] = [];
    for (let i = 0; i < to.length; i++) {
      const x = pad + (i / (to.length - 1)) * (width - pad * 2);
      pts.push(`${x},${yAt(i)}`);
    }
    return { points: pts.join(" ") };
  });
  const ringProps = useAnimatedProps(() => {
    const n = toYs.value.length;
    return { cy: n ? yAt(n - 1) : 0 };
  });
  const dotProps = useAnimatedProps(() => {
    const n = toYs.value.length;
    return { cy: n ? yAt(n - 1) : 0 };
  });

  if (values.length < 2) return <View style={{ width, height }} />;

  const lastX = pad + (width - pad * 2);

  return (
    <Svg width={width} height={height}>
      <AnimatedPolyline
        animatedProps={lineProps}
        fill="none"
        stroke={theme.colors.outline}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <AnimatedCircle animatedProps={ringProps} cx={lastX} r={5} fill={theme.colors.surface} />
      <AnimatedCircle animatedProps={dotProps} cx={lastX} r={3.5} fill={theme.colors.primary} />
    </Svg>
  );
}
