import React, { useRef } from "react";
import {
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  StyleSheet,
  Keyboard,
  View,
} from "react-native";
import { useFeedback } from "@/hooks/useFeedback";

interface KeyboardAwareScrollViewProps extends React.ComponentProps<
  typeof ScrollView
> {
  behavior?: "padding" | "height" | "position";
  keyboardVerticalOffset?: number;
  onContentSizeChange?: (width: number, height: number) => void;
}

export function KeyboardAwareScrollView({
  behavior = Platform.OS === "ios" ? "padding" : "height",
  keyboardVerticalOffset = Platform.OS === "ios" ? 0 : 20,
  onContentSizeChange,
  style,
  contentContainerStyle,
  children,
  ...props
}: KeyboardAwareScrollViewProps) {
  const scrollRef = useRef<ScrollView>(null);
  const { trigger } = useFeedback();

  const scrollToTop = () => {
    scrollRef.current?.scrollTo({ x: 0, y: 0, animated: true });
  };

  const dismissKeyboard = () => {
    Keyboard.dismiss();
    trigger("selection", { sound: false, haptic: true });
  };

  return (
    <KeyboardAvoidingView
      behavior={behavior}
      keyboardVerticalOffset={keyboardVerticalOffset}
      style={[styles.container, style]}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.contentContainer, contentContainerStyle]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        onContentSizeChange={onContentSizeChange}
        showsVerticalScrollIndicator={false}
        onTouchStart={dismissKeyboard}
        {...props}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function useKeyboardAwareScroll() {
  const scrollRef = useRef<ScrollView>(null);
  const { trigger } = useFeedback();

  const scrollToTop = () => {
    scrollRef.current?.scrollTo({ x: 0, y: 0, animated: true });
    trigger("selection", { sound: false, haptic: true });
  };

  const scrollToBottom = () => {
    scrollRef.current?.scrollToEnd({ animated: true });
    trigger("selection", { sound: false, haptic: true });
  };

  const dismissKeyboard = () => {
    Keyboard.dismiss();
    trigger("selection", { sound: false, haptic: true });
  };

  return {
    scrollRef,
    scrollToTop,
    scrollToBottom,
    dismissKeyboard,
  };
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    flexGrow: 1,
  },
});
