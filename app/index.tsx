import { Redirect } from "expo-router";

export default function Index() {
  // We remove 'auth' because URL groups with brackets () are invisible in navigation paths!
  return <Redirect href="/login" />;
}
