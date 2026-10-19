import { useMemo } from 'react';
import { FlatList } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Empty, TrackRow, s as ui } from '../../../components/ui';
import { resolveTracks } from '../../../../../app/lib/phoneLibrary';
import { useSync } from '../../../sync/SyncProvider';

export default function PlaylistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { playlists, trackById } = useSync();
  const playlist = playlists.find(p => p.id === id);
  const tracks = useMemo(() => (playlist ? resolveTracks(playlist.tracks, trackById) : []), [playlist, trackById]);

  if (!playlist) return <Empty title="Playlist not found">It may have been deleted on your computer.</Empty>;
  return (
    <>
      <Stack.Screen options={{ title: playlist.name }} />
      <FlatList
        style={ui.screen}
        data={tracks}
        keyExtractor={(t, i) => `${t.id}:${i}`}
        contentInsetAdjustmentBehavior="automatic"
        renderItem={({ item, index }) => <TrackRow track={item} index={index} onPress={() => router.push({ pathname: '/library/[id]', params: { id: item.id } })} />}
        ListEmptyComponent={<Empty title="Empty playlist" />}
      />
    </>
  );
}
