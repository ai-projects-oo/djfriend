import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { Empty, s as ui } from '../../../components/ui';
import { playlistTree, type PlaylistNode } from '../../../../../app/lib/phoneLibrary';
import { useSync } from '../../../sync/SyncProvider';
import { C } from '../../../theme';

export default function PlaylistsScreen() {
  const { playlists, folders, status, syncNow } = useSync();
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const tree = useMemo(() => playlistTree(folders, playlists), [folders, playlists]);

  // Hide everything under a collapsed folder
  const visible = useMemo(() => {
    const out: PlaylistNode[] = [];
    let hideBelow: number | null = null;
    for (const n of tree) {
      if (hideBelow != null && n.depth > hideBelow) continue;
      hideBelow = null;
      out.push(n);
      if (n.kind === 'folder' && closed.has(n.id)) hideBelow = n.depth;
    }
    return out;
  }, [tree, closed]);

  if (!tree.length) return <Empty title="No playlists yet">Playlists you make in DJFriend on your computer show up here.</Empty>;

  const toggle = (id: string) => setClosed(c => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <FlatList
      style={ui.screen}
      data={visible}
      keyExtractor={n => `${n.kind}:${n.id}`}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={status.syncing} onRefresh={() => void syncNow()} tintColor={C.accent} />}
      renderItem={({ item: n }) => (
        <Pressable
          onPress={() => (n.kind === 'folder' ? toggle(n.id) : router.push({ pathname: '/playlists/[id]', params: { id: n.id } }))}
          style={({ pressed }) => [st.row, { paddingLeft: 16 + n.depth * 18 }, pressed && { backgroundColor: C.surface }]}
          accessibilityLabel={n.kind === 'folder' ? `Folder ${n.name}` : `Playlist ${n.name}, ${n.count} tracks`}>
          <Text style={st.icon}>{n.kind === 'folder' ? (closed.has(n.id) ? '▸' : '▾') : '♪'}</Text>
          <Text style={[st.name, n.kind === 'folder' && st.folder]} numberOfLines={1}>{n.name}</Text>
          {n.kind === 'playlist' && <Text style={st.count}>{n.count}</Text>}
        </Pressable>
      )}
    />
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 16, paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  icon: { color: C.textMuted, width: 14, textAlign: 'center' },
  name: { flex: 1, color: C.text, fontSize: 15 },
  folder: { fontWeight: '600', color: C.textDim },
  count: { color: C.textMuted, fontSize: 13, fontVariant: ['tabular-nums'] },
});
