import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Empty, s as ui } from '../../../components/ui';
import { formatDate } from '../../../../../app/lib/phoneLibrary';
import { useSync } from '../../../sync/SyncProvider';
import { C } from '../../../theme';

export default function SetsScreen() {
  const { sets, status, syncNow } = useSync();
  if (!sets.length) return <Empty title="No saved sets yet">Sets you save in DJFriend on your computer show up here.</Empty>;
  return (
    <FlatList
      style={ui.screen}
      data={sets}
      keyExtractor={x => x.id}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={status.syncing} onRefresh={() => void syncNow()} tintColor={C.accent} />}
      renderItem={({ item }) => {
        const bpms = item.tracks.map(t => t.bpm).filter(b => b > 0);
        return (
          <Pressable onPress={() => router.push({ pathname: '/sets/[id]', params: { id: item.id } })}
            style={({ pressed }) => [st.row, pressed && { backgroundColor: C.surface }]} accessibilityLabel={`Set ${item.name}`}>
            <View style={{ flex: 1 }}>
              <Text style={st.name} numberOfLines={1}>{item.name}</Text>
              <Text style={st.meta}>
                {formatDate(item.timestamp)} · {item.tracks.length} tracks
                {bpms.length ? ` · ${Math.round(Math.min(...bpms))}–${Math.round(Math.max(...bpms))} BPM` : ''}
              </Text>
            </View>
            {item.rating ? <Text style={st.rating}>{'★'.repeat(item.rating)}</Text> : null}
          </Pressable>
        );
      }}
    />
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  name: { color: C.text, fontSize: 15, fontWeight: '500' },
  meta: { color: C.textMuted, fontSize: 13, marginTop: 3 },
  rating: { color: C.warn, fontSize: 12 },
});
