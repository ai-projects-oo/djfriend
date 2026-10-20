import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, s as ui } from '../components/ui';
import { useSync } from '../sync/SyncProvider';
import { C } from '../theme';

/** First run: pair with the desktop by scanning its QR code (or pasting the code). No account. */
export default function PairScreen() {
  const insets = useSafeAreaInsets();
  const { pair } = useSync();
  const [permission, requestPermission] = useCameraPermissions();
  const [pasting, setPasting] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const tryPair = async (text: string) => {
    if (busy.current) return;
    busy.current = true;
    const ok = await pair(text);
    busy.current = false;
    if (!ok) setError("That isn't a DJFriend pairing code. On your computer: DJFriend → Settings → Phone → Pair a phone.");
  };
  const onScan = (r: BarcodeScanningResult) => { void tryPair(r.data); };

  return (
    <KeyboardAvoidingView style={ui.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[st.body, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        <Text style={st.title}>DJFriend</Text>
        <Text style={st.lead}>Pair with DJFriend on your computer to carry your library, playlists and sets with you.</Text>
        <Text style={st.steps}>On your computer: Settings → Phone → Pair a phone, then scan the code.</Text>

        {!pasting && (
          <View style={st.cameraBox}>
            {!permission ? null : permission.granted ? (
              <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScan} />
            ) : (
              <View style={st.cameraPrompt}>
                <Text style={st.cameraText}>DJFriend needs the camera to scan the pairing code. It isn’t used for anything else.</Text>
                <Button label={permission.canAskAgain ? 'Allow camera' : 'Camera blocked — use Settings'} onPress={() => void requestPermission()} disabled={!permission.canAskAgain} />
              </View>
            )}
          </View>
        )}

        {pasting && (
          <View style={{ gap: 12 }}>
            <TextInput value={code} onChangeText={t => { setCode(t); setError(null); }} multiline autoCorrect={false} autoCapitalize="none"
              placeholder='Paste the pairing code ({"v":1,…})' placeholderTextColor={C.textMuted} style={[ui.search, st.codeInput]}
              accessibilityLabel="Pairing code" />
            <Button label="Pair" onPress={() => void tryPair(code)} disabled={!code.trim()} />
          </View>
        )}

        {error && <Text style={st.error}>{error}</Text>}

        <Button kind="secondary" label={pasting ? 'Scan the QR code instead' : 'Paste the code instead'} onPress={() => { setPasting(p => !p); setError(null); }} />

        <Text style={st.privacy}>
          No account, no email. Your data is encrypted on your devices — the sync server only stores data it can’t read.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  body: { paddingHorizontal: 24, gap: 16 },
  title: { color: C.text, fontSize: 32, fontWeight: '800' },
  lead: { color: C.textDim, fontSize: 16, lineHeight: 22 },
  steps: { color: C.textMuted, fontSize: 14, lineHeight: 20 },
  cameraBox: { aspectRatio: 1, borderRadius: 16, overflow: 'hidden', backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  cameraPrompt: { flex: 1, justifyContent: 'center', padding: 24, gap: 16 },
  cameraText: { color: C.textDim, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  codeInput: { minHeight: 110, textAlignVertical: 'top', fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 12 },
  error: { color: C.error, fontSize: 14, lineHeight: 20 },
  privacy: { color: C.textMuted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 8 },
});
