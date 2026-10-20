import { useMemo, type ReactElement } from 'react';
import { FlatList } from 'react-native';
import { suggestNext, type GigTrack } from '../../../app/lib/gigMode';
import type { PhoneTrack } from '../../../app/lib/phoneLibrary';
import { Empty, TrackRow } from './ui';

/** "What can I play next?" — library tracks that mix well after `current`, best first. */
export function NextList({ current, tracks, exclude, onPick, header }: {
  current: GigTrack; tracks: PhoneTrack[]; exclude?: ReadonlySet<string>;
  onPick: (t: PhoneTrack) => void; header?: ReactElement;
}) {
  const list = useMemo(() => suggestNext(current, tracks, { exclude, limit: 40 }), [current, tracks, exclude]);
  return (
    <FlatList
      data={list}
      keyExtractor={x => x.track.id}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={header}
      ListEmptyComponent={<Empty title="Nothing fits">No tracks in a compatible key within 8% of this tempo.</Empty>}
      renderItem={({ item }) => <TrackRow track={item.track} note={item.tip} onPress={() => onPick(item.track)} />}
    />
  );
}
