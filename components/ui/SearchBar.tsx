import { View, TextInput } from "react-native";

export default function SearchBar({ placeholder }: { placeholder?: string }) {
  return (
    <View>
      <TextInput placeholder={placeholder || "Search..."} />
    </View>
  );
}
