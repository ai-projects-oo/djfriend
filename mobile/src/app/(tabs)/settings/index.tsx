import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, s as ui } from '../../../components/ui';
import { timeAgo } from '../../../../../app/lib/phoneLibrary';
import { useSync } from '../../../sync/SyncProvider';
import { C } from '../../../theme';

export default function SettingsScreen() {
  const { pairing, status, lastSync, tracks, playlists, sets, releases, pending, syncNow, unpair } = useSync();
  // Re-render every 30 s so "Synced N min ago" stays current
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const confirmUnpair = () => Alert.alert(
    'Unpair this phone?',
    `Your synced library is removed from this phone. Your computer keeps everything${pending ? ` except ${pending} change${pending === 1 ? '' : 's'} made here and not sent yet` : ''}. To pair again, scan the QR code in DJFriend on your computer.`,
    [{ text: 'Cancel', style: 'cancel' }, { text: 'Unpair', style: 'destructive', onPress: () => void unpair() }],
  );

  const dot = status.error ? C.error : status.syncing ? C.warn : C.ok;
  const label = status.error ? `Sync error: ${status.error}` : status.syncing ? 'Syncing…' : lastSync ? `Synced ${timeAgo(lastSync, Math.max(now, lastSync))}` : 'Waiting for first sync';
  let relayHost = '';
  try { relayHost = pairing ? new URL(pairing.relay).host : ''; } catch { relayHost = pairing?.relay ?? ''; }

  return (
    <ScrollView style={ui.screen} contentContainerStyle={st.body} contentInsetAdjustmentBehavior="automatic">
      <Text style={ui.sectionLabel}>Sync</Text>
      <View style={st.card}>
        <View style={st.statusRow}>
          <View style={[st.dot, { backgroundColor: dot }]} />
          <Text style={st.statusText}>{label}</Text>
        </View>
        <Text style={st.counts}>
          {tracks.length.toLocaleString()} tracks · {playlists.length} playlists · {sets.length} sets
          {releases.length ? ` · ${releases.length.toLocaleString()} records` : ''}
        </Text>
        {pending > 0 && (
          <Text style={st.pending}>{pending} change{pending === 1 ? '' : 's'} made here waiting to be sent — they go out when you’re online.</Text>
        )}
        <Button label={status.syncing ? 'Syncing…' : 'Sync now'} onPress={() => void syncNow()} disabled={status.syncing} kind="secondary" />
      </View>

      <Text style={ui.sectionLabel}>Privacy</Text>
      <View style={st.card}>
        <Text style={st.text}>
          Your library is end-to-end encrypted. The sync server ({relayHost}) only stores data it can’t read. No account,
          no email, no analytics.
        </Text>
      </View>

      <Button label="Unpair this phone" onPress={confirmUnpair} kind="danger" />
    </ScrollView>
  );
}

const st = StyleSheet.create({
  body: { padding: 16, gap: 12 },
  card: { backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14, gap: 12, marginBottom: 8 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  statusText: { color: C.text, fontSize: 15, flex: 1 },
  counts: { color: C.textMuted, fontSize: 13 },
  pending: { color: C.warn, fontSize: 13 },
  text: { color: C.textDim, fontSize: 14, lineHeight: 20 },
});
