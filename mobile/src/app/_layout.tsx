import { useEffect } from 'react';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SyncProvider, useSync } from '../sync/SyncProvider';
import { C } from '../theme';

void SplashScreen.preventAutoHideAsync();

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: C.bg, card: C.surface, primary: C.accent, border: C.border, text: C.text },
};

function Routes() {
  const { ready, pairing } = useSync();
  useEffect(() => { if (ready) void SplashScreen.hideAsync(); }, [ready]);
  if (!ready) return null;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }}>
      <Stack.Protected guard={!!pairing}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Protected guard={!pairing}>
        <Stack.Screen name="pair" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider value={theme}>
      <SyncProvider>
        <StatusBar style="light" />
        <Routes />
      </SyncProvider>
    </ThemeProvider>
  );
}
