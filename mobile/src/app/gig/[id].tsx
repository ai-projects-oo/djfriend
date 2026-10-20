import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { liveLog, nextPlanIndex, transitionTip, type GigTrack } from '../../../../app/lib/gigMode';
import { NextList } from '../../components/NextList';
import { Chip, EnergyBar, Empty, KeyPill, TrackRow, s as ui } from '../../components/ui';
import { endGigSession, liveLogId, loadGigSession, saveGigSession, type GigSession } from '../../gig/session';
import { useSync } from '../../sync/SyncProvider';
import { C } from '../../theme';

/**
 * Gig mode: a saved set as a big-text cue sheet. Tap when a track starts — the taps become a live
 * set log (a new set, synced to the desktop's History). The screen stays on; works offline.
 */
export default function GigScreen() {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  const { id, fresh } = useLocalSearchParams<{ id: string; fresh?: string }>();
  const { sets, tracks, trackById, edit } = useSync();
  const set = sets.find(x => x.id === id);

  const [session, setSession] = useState<GigSession>(() => {
    const saved = loadGigSession();
    return saved && saved.setId === id && !fresh ? saved : { setId: id, startedAt: Date.now(), played: [] };
  });
  const [view, setView] = useState<'plan' | 'other'>('plan');

  // A set track as a full track: the library copy when there is one
  const resolve = useCallback((file: string): GigTrack => {
    const lib = trackById.get(file);
    if (lib) return lib;
    const t = set?.tracks.find(x => x.file === file);
    return t ? { id: file, artist: t.artist, title: t.title, bpm: t.bpm, camelot: t.camelot, energy: t.energy } : { id: file, artist: '', title: file, bpm: 0, camelot: '', energy: 0 };
  }, [trackById, set]);

  const plan = useMemo(() => set?.tracks.map(t => t.file) ?? [], [set]);
  const played = session.played;
  const playedSet = useMemo(() => new Set(played), [played]);
  const now = played.length ? resolve(played[played.length - 1]) : null;
  const nextIdx = nextPlanIndex(plan, played);
  const next = nextIdx < plan.length ? resolve(plan[nextIdx]) : null;

  const record = useCallback((list: string[]) => {
    if (!set) return;
    const s: GigSession = { ...session, played: list };
    setSession(s);
    void saveGigSession(s).catch(() => {});
    const logId = liveLogId(s);
    if (list.length) edit([{ type: 'set', id: logId, data: liveLog(`Played live: ${set.name}`, s.startedAt, list.map(resolve)) }]);
    else if (played.length) edit([{ type: 'set', id: logId, deleted: true }]);
  }, [set, session, played, edit, resolve]);

  const play = (file: string) => { record([...played, file]); setView('plan'); };
  const undo = () => record(played.slice(0, -1));
  const end = () => Alert.alert('End the gig?', played.length ? `${played.length} played tracks are saved as a set in History.` : 'Nothing was played, so no set is saved.', [
    { text: 'Keep going', style: 'cancel' },
    { text: 'End gig', style: 'destructive', onPress: () => { endGigSession(); router.back(); } },
  ]);

  if (!set) return <Empty title="Set not found">It may have been deleted on your computer.</Empty>;

  const startTime = new Date(session.startedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  return (
    <View style={[ui.screen, { paddingTop: insets.top }]}>
      <View style={st.top}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.setName} numberOfLines={1}>{set.name}</Text>
          <Text style={st.meta}>Started {startTime} · {played.length} played</Text>
        </View>
        {played.length > 0 && <Chip label="Undo" onPress={undo} />}
        <Chip label="End" onPress={end} />
      </View>

      <View style={st.nowCard}>
        <Text style={ui.sectionLabel}>Now</Text>
        {now ? (
          <>
            <Text style={st.nowTitle} numberOfLines={2}>{now.title}</Text>
            <Text style={st.nowArtist} numberOfLines={1}>{now.artist}</Text>
            <View style={st.facts}>
              <Text style={st.bigBpm}>{now.bpm ? Math.round(now.bpm) : '—'}<Text style={st.unit}> BPM</Text></Text>
              <KeyPill camelot={now.camelot} />
              <EnergyBar energy={now.energy} />
            </View>
          </>
        ) : <Text style={st.nowArtist}>Tap the first track when it starts.</Text>}
      </View>

      {next && (
        <Pressable style={({ pressed }) => [st.nextCard, pressed && { opacity: 0.85 }]} onPress={() => play(next.id)}
          accessibilityRole="button" accessibilityLabel={`Mark ${next.title} as playing`}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={ui.sectionLabel}>Next · tap when it starts</Text>
            <Text style={st.nextTitle} numberOfLines={1}>{next.title}</Text>
            <Text style={st.nextArtist} numberOfLines={1}>{next.artist}</Text>
            {now && <Text style={st.tip} numberOfLines={2}>{transitionTip(now, next)}</Text>}
          </View>
          <View style={st.nextMeta}>
            <Text style={st.nextBpm}>{next.bpm ? Math.round(next.bpm) : '—'}</Text>
            <KeyPill camelot={next.camelot} />
          </View>
        </Pressable>
      )}
      {!next && played.length > 0 && <Text style={st.done}>End of the set. Pick something from “What else fits?” or end the gig.</Text>}

      <View style={st.tabs}>
        <Chip label="Set" active={view === 'plan'} onPress={() => setView('plan')} />
        <Chip label="What else fits?" active={view === 'other'} onPress={() => setView('other')} />
      </View>

      <View style={{ flex: 1, paddingBottom: insets.bottom }}>
        {view === 'plan' ? (
          <FlatList
            data={plan}
            keyExtractor={(f, i) => `${f}:${i}`}
            initialScrollIndex={Math.min(nextIdx, Math.max(0, plan.length - 1))}
            getItemLayout={(_, i) => ({ length: ROW_H, offset: ROW_H * i, index: i })}
            onScrollToIndexFailed={() => {}}
            renderItem={({ item, index }) => {
              const t = resolve(item);
              const isPlayed = playedSet.has(item);
              return (
                <View style={{ height: ROW_H, overflow: 'hidden' }}>
                  <TrackRow track={t} index={index} done={isPlayed} note={isPlayed ? 'Played' : undefined}
                    onPress={isPlayed ? undefined : () => play(item)} missing={!trackById.has(item)} />
                </View>
              );
            }}
          />
        ) : now ? (
          <NextList current={now} tracks={tracks} exclude={playedSet} onPick={t => play(t.id)} />
        ) : (
          <Empty title="Nothing playing yet">Mark the first track as playing to see what fits after it.</Empty>
        )}
      </View>
    </View>
  );
}

const ROW_H = 72;   // TrackRow with a note line

const st = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  setName: { color: C.text, fontSize: 17, fontWeight: '700' },
  meta: { color: C.textMuted, fontSize: 12, marginTop: 2 },
  nowCard: { marginHorizontal: 16, padding: 16, borderRadius: 16, backgroundColor: C.surface, borderWidth: 1, borderColor: C.accent, gap: 4 },
  nowTitle: { color: C.text, fontSize: 30, fontWeight: '800', lineHeight: 36 },
  nowArtist: { color: C.textDim, fontSize: 18 },
  facts: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 8 },
  bigBpm: { color: C.text, fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] },
  unit: { color: C.textMuted, fontSize: 14, fontWeight: '500' },
  nextCard: { flexDirection: 'row', alignItems: 'center', gap: 12, margin: 16, marginBottom: 8, padding: 14, borderRadius: 14,
    backgroundColor: C.raised, borderWidth: 1, borderColor: C.border },
  nextTitle: { color: C.text, fontSize: 20, fontWeight: '700', marginTop: 4 },
  nextArtist: { color: C.textDim, fontSize: 15 },
  tip: { color: C.ok, fontSize: 13, marginTop: 6 },
  nextMeta: { alignItems: 'flex-end', gap: 6 },
  nextBpm: { color: C.text, fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  done: { color: C.textMuted, fontSize: 14, marginHorizontal: 16, marginVertical: 12 },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
});
