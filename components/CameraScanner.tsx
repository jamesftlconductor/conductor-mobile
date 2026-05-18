// Reusable camera/scanner sheet. Caller opens with a scanType +
// optional context; CameraScanner shows two options ("Take Photo" /
// "Choose from Library"), captures, compresses to base64, and POSTs
// to /api/scan. On success, the parent gets back the extracted data
// via onResult.

import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { SwipeDismissSheet } from './SwipeDismissSheet';

const API_BASE = 'https://conductor-ivory.vercel.app/api';

const BG = '#1a1a1a';
const OFF_WHITE = '#f0ede8';
const MUTED = '#5a5855';
const BRASS = '#b8960c';
const SOFT_BORDER = 'rgba(255,255,255,0.06)';

export type ScanType =
  | 'document'
  | 'signal_photo'
  | 'receipt'
  | 'business_card'
  | 'medication_label'
  | 'barcode';

export type ScanResult = {
  documentType: string | null;
  extractedFields: Record<string, any>;
  confidence: 'high' | 'medium' | 'low';
  photoUrl?: string;
};

type Props = {
  visible: boolean;
  userId: string;
  scanType: ScanType;
  signalId?: string | number;
  context?: Record<string, any>;
  onClose: () => void;
  onResult: (result: ScanResult) => void;
};

export function CameraScanner({
  visible,
  userId,
  scanType,
  signalId,
  context,
  onClose,
  onResult,
}: Props) {
  const [working, setWorking] = useState(false);

  async function ensureCameraPermission(): Promise<boolean> {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permission needed', 'Allow camera access to take photos.');
      return false;
    }
    return true;
  }

  async function ensureLibraryPermission(): Promise<boolean> {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo library access.');
      return false;
    }
    return true;
  }

  async function send(base64: string) {
    setWorking(true);
    try {
      const res = await fetch(`${API_BASE}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          scanType,
          imageBase64: base64,
          context: context || null,
          signalId,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        Alert.alert('Scan failed', data?.error || `Status ${res.status}`);
        return;
      }
      const data = await res.json();
      onResult({
        documentType: data?.documentType ?? null,
        extractedFields: data?.extractedFields || {},
        confidence: data?.confidence || 'low',
        photoUrl: data?.photoUrl,
      });
      onClose();
    } catch (err: any) {
      Alert.alert('Network error', err?.message || String(err));
    } finally {
      setWorking(false);
    }
  }

  async function takePhoto() {
    if (!(await ensureCameraPermission())) return;
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.8,
      base64: true,
    });
    if (result.canceled || !result.assets?.[0]?.base64) return;
    await send(result.assets[0].base64);
  }

  async function pickFromLibrary() {
    if (!(await ensureLibraryPermission())) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.8,
      base64: true,
    });
    if (result.canceled || !result.assets?.[0]?.base64) return;
    await send(result.assets[0].base64);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <SwipeDismissSheet style={styles.sheet} onClose={onClose}>
          <Pressable onPress={() => {}}>
            {working ? (
              <View style={styles.workingBlock}>
                <ActivityIndicator color={BRASS} />
                <Text style={styles.workingText}>Conductor is reading…</Text>
              </View>
            ) : (
              <>
                <Text style={styles.title}>{scanLabel(scanType)}</Text>
                <Text style={styles.subtitle}>
                  Conductor will read the image and pre-fill the form.
                </Text>
                <TouchableOpacity onPress={takePhoto} style={styles.optionBtn} activeOpacity={0.7}>
                  <Text style={styles.optionEmoji}>📷</Text>
                  <Text style={styles.optionLabel}>Take Photo</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={pickFromLibrary} style={styles.optionBtn} activeOpacity={0.7}>
                  <Text style={styles.optionEmoji}>🖼</Text>
                  <Text style={styles.optionLabel}>Choose from Library</Text>
                </TouchableOpacity>
              </>
            )}
          </Pressable>
        </SwipeDismissSheet>
      </Pressable>
    </Modal>
  );
}

function scanLabel(t: ScanType): string {
  switch (t) {
    case 'document': return 'Scan a document';
    case 'signal_photo': return 'Attach a photo';
    case 'receipt': return 'Scan a receipt';
    case 'business_card': return 'Scan a business card';
    case 'medication_label': return 'Scan a medication label';
    case 'barcode': return 'Scan a tracking number';
  }
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: BG,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 22,
    paddingBottom: 36,
    paddingTop: 4,
  },
  title: {
    color: OFF_WHITE,
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 6,
  },
  subtitle: { color: MUTED, fontSize: 12, textAlign: 'center', marginTop: 4, marginBottom: 20 },
  optionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: SOFT_BORDER,
    backgroundColor: 'rgba(255,255,255,0.02)',
    marginBottom: 10,
    gap: 12,
  },
  optionEmoji: { fontSize: 20 },
  optionLabel: { color: OFF_WHITE, fontSize: 14, fontWeight: '500' },
  workingBlock: { paddingVertical: 40, alignItems: 'center', gap: 14 },
  workingText: { color: MUTED, fontSize: 13 },
});
