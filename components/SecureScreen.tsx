// SecureScreen — wrap any screen that contains sensitive data with
// this component to gate display behind biometric auth.
//
// Behavior:
//   - On mount: check getSettings + isLockedOut. If locked, render
//     a frosted overlay covering the children and prompt for auth.
//   - On successful auth: dismiss the overlay, touchActive() so the
//     timeout clock resets.
//   - On failed auth: show "Authentication failed" with a Try Again
//     button. The overlay stays up until success.
//   - When security is disabled in settings (or biometrics aren't
//     available on this device), this component is transparent:
//     children render immediately, no overlay.

import { ReactNode, useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { PulsingCMark } from '@/components/PulsingCMark';
import {
  authenticateAsync,
  getSettings,
  isAvailable,
  isLockedOut,
  touchActive,
} from '@/app/security';

const BG = 'rgba(15, 15, 15, 0.92)';
const OFF_WHITE = '#f0ede8';
const BRASS = '#b8960c';

type Props = {
  children: ReactNode;
  screenName: string;
  requireAuth?: boolean;
};

export function SecureScreen({ children, screenName, requireAuth = true }: Props) {
  const [unlocked, setUnlocked] = useState(false);
  const [checking, setChecking] = useState(true);
  const [authFailed, setAuthFailed] = useState(false);

  const evaluate = useCallback(async () => {
    if (!requireAuth) {
      setUnlocked(true);
      setChecking(false);
      // Track activity even when this screen doesn't require auth so
      // the timeout clock on other screens stays accurate.
      await touchActive();
      return;
    }
    const settings = await getSettings();
    if (!settings.enabled || !settings.protectSensitive) {
      setUnlocked(true);
      setChecking(false);
      await touchActive();
      return;
    }
    const available = await isAvailable();
    if (!available) {
      // No biometric hardware → can't gate. Fail open (still show)
      // since the user can't enroll.
      setUnlocked(true);
      setChecking(false);
      return;
    }
    const locked = await isLockedOut();
    if (!locked) {
      setUnlocked(true);
      setChecking(false);
      return;
    }
    setUnlocked(false);
    setChecking(false);
    // Prompt right away.
    const ok = await authenticateAsync(`Authenticate to view ${screenName}`);
    if (ok) {
      await touchActive();
      setUnlocked(true);
      setAuthFailed(false);
    } else {
      setAuthFailed(true);
    }
  }, [requireAuth, screenName]);

  useEffect(() => {
    evaluate();
  }, [evaluate]);

  async function retry() {
    setAuthFailed(false);
    const ok = await authenticateAsync(`Authenticate to view ${screenName}`);
    if (ok) {
      await touchActive();
      setUnlocked(true);
    } else {
      setAuthFailed(true);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      {children}
      {!unlocked || checking ? (
        <View style={styles.overlay} pointerEvents="auto">
          {checking ? (
            <PulsingCMark size={30} />
          ) : (
            <>
              <Text style={styles.icon}>🔒</Text>
              <Text style={styles.title}>Authenticate to view {screenName}</Text>
              {authFailed ? (
                <Text style={styles.failedText}>Authentication failed.</Text>
              ) : null}
              <TouchableOpacity onPress={retry} style={styles.btn} activeOpacity={0.7}>
                <Text style={styles.btnText}>
                  {authFailed ? 'Try again' : 'Authenticate'}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  icon: { fontSize: 48, marginBottom: 24 },
  title: {
    color: OFF_WHITE,
    fontSize: 15,
    textAlign: 'center',
    fontWeight: '500',
    letterSpacing: 0.2,
    marginBottom: 16,
  },
  failedText: { color: '#d97757', fontSize: 13, marginBottom: 14 },
  btn: {
    backgroundColor: BRASS,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 24,
    marginTop: 8,
  },
  btnText: { color: '#0f0f0f', fontSize: 14, fontWeight: '600', letterSpacing: 0.5 },
});
