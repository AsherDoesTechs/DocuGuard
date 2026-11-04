import '@expo/metro-runtime';
import { renderRootComponent } from 'expo-router/build/renderRootComponent';
import { ExpoRoot } from 'expo-router/build/ExpoRoot';
import * as _ctx from 'expo-router/_ctx';
import { Head } from 'expo-router/build/head';

function App() {
  return (
    <Head.Provider>
      <ExpoRoot context={_ctx.ctx} />
    </Head.Provider>
  );
}

renderRootComponent(App);