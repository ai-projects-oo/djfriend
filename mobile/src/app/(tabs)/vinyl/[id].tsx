import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import type { VinylReleaseData, VinylTrackEntry } from '../../../../../app/types';
import { editVinylTrack, nextPosition } from '../../../../../app/lib/vinylTracks';
import { camelotColor } from '../../../../../app/lib/camelotColors';
import { Button, Empty, KeyPill, s as ui } from '../../../components/ui';
import { useSync } from '../../../sync/SyncProvider';
import { C } from '../../../theme';

/** Same id scheme as the desktop's Crates tab. */
const newTrackId = (releaseId: string) => `${releaseId}-${Date.now()}`;

const KEYS = [...Array.from({ length: 12 }, (_, i) => `${i + 1}A`), ...Array.from({ length: 12 }, (_, i) => `${i + 1}B`)];

/** One record: its tracks with key / BPM. Edits are saved on the phone and synced to the desktop's Crates. */
export default function ReleaseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { releases, vinylById, edit } = useSync();
  const release = releases.find(r => r.id === id);
  const data: VinylReleaseData = vinylById.get(id) ?? { tracks: [] };
  const [open, setOpen] = useState<string | null>(null);

  if (!release) return <Empty title="Record not found">It may have been removed from your Discogs collection.</Empty>;

  const save = (tracks: VinylTrackEntry[]) => edit([{ type: 'vinylTrack', id, data: { ...data, tracks } }]);
  const add = () => {
    const t: VinylTrackEntry = { id: newTrackId(id), position: nextPosition(data.tracks) };
    save([...data.tracks, t]);
    setOpen(t.id);
  };

  return (
    <KeyboardAvoidingView style={ui.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: '' }} />
      <ScrollView contentContainerStyle={st.body} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
        <Text style={st.title}>{release.title}</Text>
        <Text style={st.artist}>{release.artist}{release.year ? ` · ${release.year}` : ''}</Text>
        {release.formats.length > 0 && <Text style={st.meta}>{release.formats.join(', ')}</Text>}

        <Text style={ui.sectionLabel}>Tracks</Text>
        {data.tracks.length === 0 && <Text style={st.meta}>No tracks yet. Add the ones you play, with their key and BPM.</Text>}
        {data.tracks.map(t => open === t.id ? (
          <TrackEditor key={t.id} track={t}
            onSave={next => { save(data.tracks.map(x => x.id === t.id ? next : x)); setOpen(null); }}
            onDelete={() => { save(data.tracks.filter(x => x.id !== t.id)); setOpen(null); }}
            onCancel={() => setOpen(null)} />
        ) : (
          <Pressable key={t.id} onPress={() => setOpen(t.id)} style={({ pressed }) => [st.track, pressed && { backgroundColor: C.raised }]}
            accessibilityLabel={`Edit ${t.position} ${t.title ?? ''}`}>
            <Text style={st.pos}>{t.position}</Text>
            <Text style={st.trackTitle} numberOfLines={1}>{t.title || 'Untitled'}</Text>
            <Text style={st.bpm}>{t.bpm ? Math.round(t.bpm * 10) / 10 : '—'}</Text>
            <KeyPill camelot={t.camelot ?? ''} />
          </Pressable>
        ))}
        <Button kind="secondary" label="Add a track" onPress={add} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function TrackEditor({ track, onSave, onDelete, onCancel }: {
  track: VinylTrackEntry; onSave: (t: VinylTrackEntry) => void; onDelete: () => void; onCancel: () => void;
}) {
  const [position, setPosition] = useState(track.position);
  const [title, setTitle] = useState(track.title ?? '');
  const [bpm, setBpm] = useState(track.bpm ? String(track.bpm) : '');
  const [camelot, setCamelot] = useState(track.camelot ?? '');
  const bpmNum = bpm.trim() ? Number(bpm.replace(',', '.')) : undefined;
  const bpmOk = bpmNum == null || (Number.isFinite(bpmNum) && bpmNum >= 40 && bpmNum <= 250);

  const submit = () => {
    const patch: Parameters<typeof editVinylTrack>[1] = {};
    if (position.trim().toUpperCase() !== track.position) patch.position = position.trim().toUpperCase() || track.position;
    if ((title.trim() || undefined) !== track.title) patch.title = title.trim() || undefined;
    if (bpmNum !== track.bpm) patch.bpm = bpmNum;
    if ((camelot || undefined) !== track.camelot) patch.camelot = camelot || undefined;
    onSave(Object.keys(patch).length ? editVinylTrack(track, patch) : track);
  };

  return (
    <View style={st.editor}>
      <View style={st.inputs}>
        <TextInput value={position} onChangeText={setPosition} autoCapitalize="characters" autoCorrect={false} maxLength={4}
          style={[ui.search, st.posInput]} accessibilityLabel="Position" placeholder="A1" placeholderTextColor={C.textMuted} />
        <TextInput value={title} onChangeText={setTitle} style={[ui.search, { flex: 1 }]} placeholder="Title"
          placeholderTextColor={C.textMuted} accessibilityLabel="Title" />
      </View>
      <TextInput value={bpm} onChangeText={setBpm} keyboardType="decimal-pad" style={[ui.search, !bpmOk && { borderColor: C.error }]}
        placeholder="BPM" placeholderTextColor={C.textMuted} accessibilityLabel="BPM" />
      <View style={st.keys}>
        {KEYS.map(k => {
          const on = camelot === k, color = camelotColor(k);
          return (
            <Pressable key={k} onPress={() => setCamelot(on ? '' : k)} accessibilityRole="button" accessibilityState={{ selected: on }}
              style={[st.key, { borderColor: color }, on && { backgroundColor: color }]}>
              <Text style={[st.keyText, { color: on ? '#0d0d14' : color }]}>{k}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={st.inputs}>
        <Button label="Save" onPress={submit} disabled={!bpmOk} style={{ flex: 1 }} />
        <Button kind="secondary" label="Cancel" onPress={onCancel} />
        <Button kind="danger" label="Delete" onPress={onDelete} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  body: { padding: 20, gap: 12 },
  title: { color: C.text, fontSize: 22, fontWeight: '700' },
  artist: { color: C.textDim, fontSize: 16, marginTop: -6 },
  meta: { color: C.textMuted, fontSize: 13 },
  track: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  pos: { color: C.textMuted, fontSize: 13, width: 30, fontVariant: ['tabular-nums'] },
  trackTitle: { color: C.text, fontSize: 15, flex: 1 },
  bpm: { color: C.textDim, fontSize: 13, fontVariant: ['tabular-nums'] },
  editor: { padding: 12, borderRadius: 12, backgroundColor: C.surface, borderWidth: 1, borderColor: C.accent, gap: 10 },
  inputs: { flexDirection: 'row', gap: 8 },
  posInput: { width: 64, textAlign: 'center' },
  keys: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  key: { width: 46, paddingVertical: 7, borderRadius: 6, borderWidth: 1, alignItems: 'center' },
  keyText: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
