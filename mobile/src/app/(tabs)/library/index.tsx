import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Chip, Empty, SearchBar, TrackRow, s as ui } from '../../../components/ui';
import { filterTracks, type TrackSort } from '../../../../../app/lib/phoneLibrary';
import { useSync } from '../../../sync/SyncProvider';
import { C } from '../../../theme';

const SORTS: { id: TrackSort; label: string }[] = [
  { id: 'artist', label: 'Artist' }, { id: 'title', label: 'Title' }, { id: 'bpm', label: 'BPM' },
  { id: 'key', label: 'Key' }, { id: 'energy', label: 'Energy' },
];

export default function LibraryScreen() {
  const { tracks, status, lastSync, syncNow } = useSync();
  const params = useLocalSearchParams<{ mix?: string; bpm?: string }>();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<TrackSort>('artist');
  const mixBpm = params.bpm ? Number(params.bpm) : undefined;

  const shown = useMemo(() => filterTracks(tracks, {
    query, sort, mixesWith: params.mix || undefined,
    ...(mixBpm ? { bpmMin: mixBpm * 0.94, bpmMax: mixBpm * 1.06 } : {}),
  }), [tracks, query, sort, params.mix, mixBpm]);

  if (!tracks.length) {
    return status.syncing || !lastSync
      ? <Empty title="Syncing your library…" busy>Keep DJFriend open on your computer the first time.</Empty>
      : <Empty title="No tracks yet">{status.error ? `Sync error: ${status.error}` : 'Open DJFriend on your computer — your library syncs within a couple of minutes.'}</Empty>;
  }

  return (
    <View style={ui.screen}>
      <View style={st.controls}>
        <SearchBar value={query} onChange={setQuery} placeholder={`Search ${tracks.length.toLocaleString()} tracks`} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.chips}>
          {SORTS.map(o => <Chip key={o.id} label={o.label} active={sort === o.id} onPress={() => setSort(o.id)} />)}
        </ScrollView>
        {params.mix ? (
          <Pressable style={st.mixBanner} onPress={() => router.setParams({ mix: '', bpm: '' })} accessibilityLabel="Clear mix filter">
            <Text style={st.mixText}>Mixes with {params.mix}{mixBpm ? ` · ${Math.round(mixBpm)} BPM ±6%` : ''} — {shown.length} tracks</Text>
            <Text style={st.mixClear}>Clear</Text>
          </Pressable>
        ) : null}
      </View>
      <FlatList
        data={shown}
        keyExtractor={t => t.id}
        renderItem={({ item }) => <TrackRow track={item} onPress={() => router.push({ pathname: '/library/[id]', params: { id: item.id } })} />}
        initialNumToRender={20}
        windowSize={11}
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={status.syncing} onRefresh={() => void syncNow()} tintColor={C.accent} />}
        ListEmptyComponent={<Empty title="No matches" />}
      />
    </View>
  );
}

const st = StyleSheet.create({
  controls: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, gap: 10, backgroundColor: C.bg },
  chips: { gap: 8 },
  mixBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: `${C.accent}26`,
    borderColor: C.accent, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  mixText: { color: C.text, fontSize: 13, flex: 1 },
  mixClear: { color: C.accent, fontSize: 13, fontWeight: '600', marginLeft: 12 },
});
