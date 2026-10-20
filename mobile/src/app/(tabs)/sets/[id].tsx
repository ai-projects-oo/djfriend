import { FlatList, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { isHarmonicWarning } from '../../../../../app/lib/camelot';
import { Empty, TrackRow, s as ui } from '../../../components/ui';
import { useSync } from '../../../sync/SyncProvider';
import { C } from '../../../theme';

export default function SetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { sets, trackById } = useSync();
  const set = sets.find(x => x.id === id);
  if (!set) return <Empty title="Set not found">It may have been deleted on your computer.</Empty>;

  return (
    <>
      <Stack.Screen options={{ title: set.name }} />
      <FlatList
        style={ui.screen}
        data={set.tracks}
        keyExtractor={(t, i) => `${t.file}:${i}`}
        contentInsetAdjustmentBehavior="automatic"
        ListHeaderComponent={set.notes ? <Text style={st.notes}>{set.notes}</Text> : undefined}
        renderItem={({ item, index }) => {
          const lib = trackById.get(item.file);
          const prev = index > 0 ? set.tracks[index - 1] : null;
          const clash = !!prev && !!prev.camelot && !!item.camelot && isHarmonicWarning(prev.camelot, item.camelot);
          return (
            <View>
              {clash && <Text style={st.clash}>⚠ Key clash {prev.camelot} → {item.camelot}</Text>}
              <TrackRow track={{ ...item, duration: lib?.duration }} index={index} missing={!lib}
                onPress={lib ? () => router.push({ pathname: '/library/[id]', params: { id: lib.id } }) : undefined} />
            </View>
          );
        }}
      />
    </>
  );
}

const st = StyleSheet.create({
  notes: { color: C.textMuted, fontSize: 14, padding: 16, fontStyle: 'italic' },
  clash: { color: C.warn, fontSize: 11, paddingHorizontal: 16, paddingTop: 6 },
});
