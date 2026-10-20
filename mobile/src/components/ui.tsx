import { memo, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type ViewStyle } from 'react-native';
import { camelotColor } from '../../../app/lib/camelotColors';
import { formatDuration, type PhoneTrack } from '../../../app/lib/phoneLibrary';
import { C } from '../theme';

export function KeyPill({ camelot }: { camelot: string }) {
  const color = camelotColor(camelot);
  return (
    <View style={[s.pill, { borderColor: color, backgroundColor: `${color}33` }]}>
      <Text style={[s.pillText, { color }]}>{camelot || '—'}</Text>
    </View>
  );
}

export function EnergyBar({ energy }: { energy: number }) {
  const pct = Math.max(0, Math.min(1, energy)) * 100;
  return (
    <View style={s.energyTrack} accessibilityLabel={`Energy ${Math.round(pct)}`}>
      <View style={[s.energyFill, { width: `${pct}%` }]} />
    </View>
  );
}

export interface TrackRowProps {
  track: Pick<PhoneTrack, 'artist' | 'title' | 'bpm' | 'camelot' | 'energy'> & { duration?: number };
  index?: number;
  onPress?: () => void;
  /** Shown when the track is no longer in the library (e.g. a set made from since-removed tracks). */
  missing?: boolean;
  /** A small extra line under the artist (e.g. a mixing tip). */
  note?: string;
  /** Dimmed (e.g. already played). */
  done?: boolean;
}

export const TrackRow = memo(function TrackRow({ track, index, onPress, missing, note, done }: TrackRowProps) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [s.row, pressed && s.rowPressed, done && { opacity: 0.45 }]}
      accessibilityLabel={`${track.title} by ${track.artist}, ${Math.round(track.bpm)} BPM, key ${track.camelot}`}>
      {index != null && <Text style={s.index}>{index + 1}</Text>}
      <View style={s.rowMain}>
        <Text style={[s.title, missing && s.missing]} numberOfLines={1}>{track.title}</Text>
        <Text style={s.artist} numberOfLines={1}>{track.artist}</Text>
        {note ? <Text style={s.note} numberOfLines={1}>{note}</Text> : null}
      </View>
      <View style={s.rowMeta}>
        <View style={s.metaTop}>
          <Text style={s.bpm}>{track.bpm ? Math.round(track.bpm) : '—'}</Text>
          <KeyPill camelot={track.camelot} />
        </View>
        <View style={s.metaBottom}>
          <EnergyBar energy={track.energy} />
          {track.duration != null && <Text style={s.duration}>{formatDuration(track.duration)}</Text>}
        </View>
      </View>
    </Pressable>
  );
});

export function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={C.textMuted}
      style={s.search} autoCorrect={false} autoCapitalize="none" clearButtonMode="while-editing" returnKeyType="search"
      accessibilityLabel={placeholder} />
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, active && s.chipActive]} accessibilityRole="button" accessibilityState={{ selected: !!active }}>
      <Text style={[s.chipText, active && s.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

export function Button({ label, onPress, kind = 'primary', disabled, style }: {
  label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; disabled?: boolean; style?: ViewStyle;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button"
      style={({ pressed }) => [s.btn, kind === 'primary' ? s.btnPrimary : kind === 'danger' ? s.btnDanger : s.btnSecondary,
        pressed && { opacity: 0.8 }, disabled && { opacity: 0.4 }, style]}>
      <Text style={[s.btnText, kind === 'danger' && { color: C.error }]}>{label}</Text>
    </Pressable>
  );
}

export function Empty({ title, children, busy }: { title: string; children?: ReactNode; busy?: boolean }) {
  return (
    <View style={s.empty}>
      {busy && <ActivityIndicator color={C.accent} style={{ marginBottom: 12 }} />}
      <Text style={s.emptyTitle}>{title}</Text>
      {typeof children === 'string' ? <Text style={s.emptyText}>{children}</Text> : children}
    </View>
  );
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  pill: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, minWidth: 34, alignItems: 'center' },
  pillText: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  energyTrack: { width: 44, height: 4, borderRadius: 2, backgroundColor: C.raised, overflow: 'hidden' },
  energyFill: { height: 4, borderRadius: 2, backgroundColor: C.accent },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  rowPressed: { backgroundColor: C.surface },
  index: { width: 22, color: C.textMuted, fontSize: 13, fontVariant: ['tabular-nums'], textAlign: 'right' },
  rowMain: { flex: 1, minWidth: 0 },
  title: { color: C.text, fontSize: 15, fontWeight: '500' },
  missing: { color: C.textMuted, fontStyle: 'italic' },
  artist: { color: C.textMuted, fontSize: 13, marginTop: 2 },
  note: { color: C.textMuted, fontSize: 11, marginTop: 3 },
  rowMeta: { alignItems: 'flex-end', gap: 5 },
  metaTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaBottom: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bpm: { color: C.textDim, fontSize: 13, fontVariant: ['tabular-nums'] },
  duration: { color: C.textMuted, fontSize: 11, fontVariant: ['tabular-nums'] },
  search: { backgroundColor: C.raised, borderColor: C.border, borderWidth: 1, borderRadius: 10, color: C.text,
    paddingHorizontal: 12, paddingVertical: 9, fontSize: 15 },
  chip: { borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingHorizontal: 11, paddingVertical: 5 },
  chipActive: { backgroundColor: C.accent, borderColor: C.accent },
  chipText: { color: C.textDim, fontSize: 13 },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  btn: { borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center' },
  btnPrimary: { backgroundColor: C.accent },
  btnSecondary: { borderWidth: 1, borderColor: C.border },
  btnDanger: { borderWidth: 1, borderColor: `${C.error}66` },
  btnText: { color: C.text, fontSize: 15, fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { color: C.text, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  emptyText: { color: C.textMuted, fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  sectionLabel: { color: C.textMuted, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
});
