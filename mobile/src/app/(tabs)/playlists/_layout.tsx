import { Stack } from 'expo-router';
import { C } from '../../../theme';

export default function PlaylistsLayout() {
  return (
    <Stack screenOptions={{
      headerStyle: { backgroundColor: C.surface }, headerTintColor: C.text, headerShadowVisible: false,
      contentStyle: { backgroundColor: C.bg }, headerLargeTitle: false,
    }}>
      <Stack.Screen name="index" options={{ title: 'Playlists' }} />
    </Stack>
  );
}
