import { Redirect } from "expo-router";

export default function Index() {
  // Authenticated users land on Documents; the auth guard in _layout.tsx
  // redirects unauthenticated users to /login before this screen renders.
  return <Redirect href="/(tabs)/documents" />;
}
