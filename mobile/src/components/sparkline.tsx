import { View } from "react-native";
import { useTheme } from "react-native-paper";
import Svg, { Circle, Polyline } from "react-native-svg";

// Stat-tile trend sparkline: the history line rides in a de-emphasis hue and
// only the current sample wears the accent (with a surface ring so it stays
// legible on top of the line). Identity comes from the row's text label, so
// there is no legend and the line color carries no meaning.
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
  if (values.length < 2) return <View style={{ width, height }} />;

  const max = Math.max(...values, 1);
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2);
  const y = (v: number) => height - pad - (v / max) * (height - pad * 2);
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const lastX = x(values.length - 1);
  const lastY = y(values[values.length - 1]);

  return (
    <Svg width={width} height={height}>
      <Polyline
        points={points}
        fill="none"
        stroke={theme.colors.outline}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={lastX} cy={lastY} r={5} fill={theme.colors.surface} />
      <Circle cx={lastX} cy={lastY} r={3.5} fill={theme.colors.primary} />
    </Svg>
  );
}
