import { useDeferredValue, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Empty, SearchBar, s as ui } from '../../../components/ui';
import { filterReleases } from '../../../../../app/lib/phoneLibrary';
import { useSync } from '../../../sync/SyncProvider';
import { C } from '../../../theme';

/** Your Discogs collection (synced from the desktop), to add keys / BPM for the tracks on each record. */
export default function VinylScreen() {
  const { releases, status, syncNow } = useSync();
  const [query, setQuery] = useState('');
  const q = useDeferredValue(query);
  const list = useMemo(() => filterReleases(releases, q), [releases, q]);

  if (!releases.length) {
    return <Empty title="No records yet">Connect Discogs in DJFriend on your computer (Crates tab) and your collection shows up here.</Empty>;
  }
  return (
    <FlatList
      style={ui.screen}
      data={list}
      keyExtractor={x => x.id}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={<View style={st.search}><SearchBar value={query} onChange={setQuery} placeholder={`Search ${releases.length} records`} /></View>}
      refreshControl={<RefreshControl refreshing={status.syncing} onRefresh={() => void syncNow()} tintColor={C.accent} />}
      renderItem={({ item }) => (
        <Pressable onPress={() => router.push({ pathname: '/vinyl/[id]', params: { id: item.id } })}
          style={({ pressed }) => [st.row, pressed && { backgroundColor: C.surface }]} accessibilityLabel={`${item.title} by ${item.artist}`}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={st.title} numberOfLines={1}>{item.title}</Text>
            <Text style={st.meta} numberOfLines={1}>{item.artist}{item.year ? ` · ${item.year}` : ''}</Text>
          </View>
          {item.tracks > 0 && <Text style={[st.keys, item.keyed === item.tracks && { color: C.ok }]}>{item.keyed}/{item.tracks} keys</Text>}
        </Pressable>
      )}
    />
  );
}

const st = StyleSheet.create({
  search: { padding: 12 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 11, gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  title: { color: C.text, fontSize: 15, fontWeight: '500' },
  meta: { color: C.textMuted, fontSize: 13, marginTop: 2 },
  keys: { color: C.textMuted, fontSize: 12, fontVariant: ['tabular-nums'] },
});
