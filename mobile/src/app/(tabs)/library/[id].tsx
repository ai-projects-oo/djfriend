import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { CAMELOT_TO_KEY } from '../../../../../app/lib/camelot';
import { Button, EnergyBar, Empty, KeyPill, s as ui } from '../../../components/ui';
import { formatDuration } from '../../../../../app/lib/phoneLibrary';
import { useSync } from '../../../sync/SyncProvider';
import { C } from '../../../theme';

export default function TrackScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { trackById, playlists } = useSync();
  const t = trackById.get(id);
  if (!t) return <Empty title="Track not found">It may have been removed from your library.</Empty>;
  const inPlaylists = playlists.filter(p => p.tracks.includes(t.id)).sort((a, b) => a.name.localeCompare(b.name));

  const facts: [string, string][] = [
    ['BPM', t.bpm ? String(Math.round(t.bpm * 10) / 10) : '—'],
    ['Key', t.key || CAMELOT_TO_KEY[t.camelot] || '—'],
    ['Energy', `${Math.round(t.energy * 100)}`],
    ...(t.duration != null ? [['Length', formatDuration(t.duration)] as [string, string]] : []),
    ...(t.year ? [['Year', String(t.year)] as [string, string]] : []),
    ...(t.genres.length ? [['Genre', t.genres.join(', ')] as [string, string]] : []),
  ];

  return (
    <ScrollView style={ui.screen} contentContainerStyle={st.body} contentInsetAdjustmentBehavior="automatic">
      <Stack.Screen options={{ title: '' }} />
      <Text style={st.title}>{t.title}</Text>
      <Text style={st.artist}>{t.artist}</Text>
      <View style={st.badges}><KeyPill camelot={t.camelot} /><EnergyBar energy={t.energy} /></View>

      <View style={st.card}>
        {facts.map(([k, v]) => (
          <View key={k} style={st.fact}><Text style={st.factKey}>{k}</Text><Text style={st.factVal}>{v}</Text></View>
        ))}
      </View>
      {t.comment ? <Text style={st.comment}>{t.comment}</Text> : null}

      <Button label="What can I play next?" onPress={() => router.push({ pathname: '/library/next/[id]', params: { id: t.id } })} />
      <Button kind="secondary" label="All matching tracks" onPress={() => router.navigate({ pathname: '/library', params: { mix: t.camelot, bpm: String(t.bpm) } })} disabled={!t.camelot} />

      {inPlaylists.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={ui.sectionLabel}>In playlists</Text>
          {inPlaylists.map(p => (
            <Text key={p.id} style={st.link} onPress={() => router.navigate({ pathname: '/playlists/[id]', params: { id: p.id } })}>{p.name}</Text>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  body: { padding: 20, gap: 16 },
  title: { color: C.text, fontSize: 24, fontWeight: '700' },
  artist: { color: C.textDim, fontSize: 17, marginTop: -10 },
  badges: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  card: { backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14 },
  fact: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border, gap: 16 },
  factKey: { color: C.textMuted, fontSize: 14 },
  factVal: { color: C.text, fontSize: 14, flexShrink: 1, textAlign: 'right' },
  comment: { color: C.textMuted, fontSize: 13, fontStyle: 'italic' },
  link: { color: C.accent, fontSize: 15, paddingVertical: 4 },
});
