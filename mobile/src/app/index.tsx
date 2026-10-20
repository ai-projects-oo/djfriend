import { Redirect } from 'expo-router';
import { useSync } from '../sync/SyncProvider';

export default function Index() {
  const { pairing } = useSync();
  return <Redirect href={pairing ? '/library' : '/pair'} />;
}
