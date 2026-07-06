import type { ReactNode } from "react";
import Animated, { FadeInDown, FadeOut, LinearTransition } from "react-native-reanimated";

// Wrapper for conditionally rendered form sections: slides/fades in on mount,
// fades out on unmount, and eases its own layout shifts instead of popping.
export function Reveal({ children }: { children: ReactNode }) {
  return (
    <Animated.View
      entering={FadeInDown.duration(180)}
      exiting={FadeOut.duration(120)}
      layout={LinearTransition.duration(180)}
    >
      {children}
    </Animated.View>
  );
}
