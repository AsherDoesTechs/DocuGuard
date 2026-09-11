import { View, Text } from "react-native";

export default function Header({ title }: { title: string }) {
  return (
    <View>
      <Text>{title}</Text>
    </View>
  );
}
