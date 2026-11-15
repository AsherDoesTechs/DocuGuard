import React, { useRef } from "react";
import { Animated, Pressable, PressableProps, StyleProp, ViewStyle } from "react-native";

type Props = PressableProps & {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  innerStyle?: StyleProp<ViewStyle>;
};

export function PressableScale({ children, style, innerStyle, scaleTo = 0.97, onPressIn, onPressOut, ...rest }: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      {...rest}
      onPressIn={(e) => {
        Animated.spring(scale, { toValue: scaleTo, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 24, bounciness: 4 }).start();
        onPressOut?.(e);
      }}
      style={style}
    >
      <Animated.View style={[innerStyle, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}
