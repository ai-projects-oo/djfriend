import { useCallback, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { isHarmonicWarning } from '../../../../../app/lib/camelot';
import { Button, Empty, TrackRow, s as ui } from '../../../components/ui';
import { loadGigSession, type GigSession } from '../../../gig/session';
import { useSync } from '../../../sync/SyncProvider';
import { C } from '../../../theme';

export default function SetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { sets, trackById } = useSync();
  const set = sets.find(x => x.id === id);
  const [gig, setGig] = useState<GigSession | null>(null);
  useFocusEffect(useCallback(() => { setGig(loadGigSession()); }, []));
  if (!set) return <Empty title="Set not found">It may have been deleted on your computer.</Empty>;

  return (
    <>
      <Stack.Screen options={{ title: set.name }} />
      <FlatList
        style={ui.screen}
        data={set.tracks}
        keyExtractor={(t, i) => `${t.file}:${i}`}
        contentInsetAdjustmentBehavior="automatic"
        ListHeaderComponent={
          <View style={st.header}>
            {gig?.setId === set.id ? (
              <View style={st.buttons}>
                <Button label={`Resume gig (${gig.played.length} played)`} onPress={() => router.push({ pathname: '/gig/[id]', params: { id: set.id } })} style={{ flex: 1 }} />
                <Button kind="secondary" label="Start over" onPress={() => router.push({ pathname: '/gig/[id]', params: { id: set.id, fresh: '1' } })} />
              </View>
            ) : (
              <Button label="Start gig mode" disabled={!set.tracks.length} onPress={() => {
                const open = () => router.push({ pathname: '/gig/[id]', params: { id: set.id, fresh: '1' } });
                if (!gig) return open();
                Alert.alert('Another gig is in progress', 'Its played tracks are already saved. Start this set instead?', [
                  { text: 'Cancel', style: 'cancel' }, { text: 'Start', onPress: open },
                ]);
              }} />
            )}
            {set.notes ? <Text style={st.notes}>{set.notes}</Text> : null}
          </View>
        }
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
  header: { padding: 16, gap: 12 },
  buttons: { flexDirection: 'row', gap: 8 },
  notes: { color: C.textMuted, fontSize: 14, fontStyle: 'italic' },
  clash: { color: C.warn, fontSize: 11, paddingHorizontal: 16, paddingTop: 6 },
});
