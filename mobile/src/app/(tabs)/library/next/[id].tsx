import { router, Stack, useLocalSearchParams } from 'expo-router';
import { NextList } from '../../../../components/NextList';
import { Empty } from '../../../../components/ui';
import { useSync } from '../../../../sync/SyncProvider';

/** "What can I play next?" after a library track. */
export default function NextScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { trackById, tracks } = useSync();
  const t = trackById.get(id);
  if (!t) return <Empty title="Track not found">It may have been removed from your library.</Empty>;
  return (
    <>
      <Stack.Screen options={{ title: `After ${t.title}` }} />
      <NextList current={t} tracks={tracks} onPick={n => router.push({ pathname: '/library/[id]', params: { id: n.id } })} />
    </>
  );
}
