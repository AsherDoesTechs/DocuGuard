import React from "react";
import { TouchableOpacity, TouchableOpacityProps, View, ViewStyle } from "react-native";
import { useFeedback } from "@/hooks/useFeedback";

interface FeedbackButtonProps extends TouchableOpacityProps {
  feedbackType?: "success" | "error" | "warning" | "info" | "light" | "medium" | "heavy" | "selection";
  feedbackOptions?: { sound?: boolean; haptic?: boolean };
  children: React.ReactNode;
  style?: ViewStyle;
}

export function FeedbackButton({
  feedbackType = "selection",
  feedbackOptions = { sound: false, haptic: true },
  onPress,
  children,
  style,
  ...props
}: FeedbackButtonProps) {
  const { trigger } = useFeedback();

  const handlePress = async (...args: any[]) => {
    await trigger(feedbackType, feedbackOptions);
    if (onPress) {
      onPress(...args);
    }
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      style={style}
      {...props}
    >
      {children}
    </TouchableOpacity>
  );
}

interface FeedbackPressableProps extends React.ComponentPropsWithoutRef<typeof TouchableOpacity> {
  feedbackType?: "success" | "error" | "warning" | "info" | "light" | "medium" | "heavy" | "selection";
  feedbackOptions?: { sound?: boolean; haptic?: boolean };
}

export function withFeedback<P extends object>(
  Component: React.ComponentType<P>,
  feedbackType: "success" | "error" | "warning" | "info" | "light" | "medium" | "heavy" | "selection" = "selection",
  feedbackOptions?: { sound?: boolean; haptic?: boolean }
) {
  return function WithFeedbackWrapper(props: P) {
    const { trigger } = useFeedback();
    
    const originalOnPress = (props as any).onPress;
    
    const handlePress = async (...args: any[]) => {
      await trigger(feedbackType, feedbackOptions);
      if (originalOnPress) {
        originalOnPress(...args);
      }
    };
    
    return <Component {...props} onPress={handlePress} />;
  };
}

export function useFeedbackTrigger() {
  const { trigger } = useFeedback();
  
  return {
    success: () => trigger("success"),
    error: () => trigger("error"),
    warning: () => trigger("warning"),
    info: () => trigger("info"),
    light: () => trigger("light"),
    medium: () => trigger("medium"),
    heavy: () => trigger("heavy"),
    selection: () => trigger("selection"),
    custom: (type: "success" | "error" | "warning" | "info" | "light" | "medium" | "heavy" | "selection", options?: { sound?: boolean; haptic?: boolean }) => 
      trigger(type, options),
  };
}