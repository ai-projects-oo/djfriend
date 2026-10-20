import { NativeTabs } from 'expo-router/native-tabs';
import { C } from '../../theme';

export default function TabsLayout() {
  return (
    <NativeTabs backgroundColor={C.surface} tintColor={C.accent} iconColor={C.textMuted} indicatorColor={C.raised}
      labelStyle={{ color: C.textMuted, selected: { color: C.text } }} disableTransparentOnScrollEdge>
      <NativeTabs.Trigger name="library">
        <NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="music.note.list" md="library_music" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="playlists">
        <NativeTabs.Trigger.Label>Playlists</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="list.bullet.rectangle" md="queue_music" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="sets">
        <NativeTabs.Trigger.Label>Sets</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="clock.arrow.circlepath" md="history" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="vinyl">
        <NativeTabs.Trigger.Label>Vinyl</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="opticaldisc" md="album" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="gear" md="settings" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
