// On-screen diagnostic banner — pinned to the top, renders the most
// recent debugLog entries, pointer-events none so it never blocks
// taps. Tap-and-hold the top-right corner to clear.
//
// Production-toggle via DEBUG_BANNER_ENABLED in utils/debugLog. Set
// to false to make this a no-op without removing the instrumentation
// calls scattered around the app.

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { clearDebugLog, DEBUG_BANNER_ENABLED, useDebugLog } from '@/utils/debugLog';

function formatTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const xxx = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${xxx}`;
}

export function DebugBanner() {
  const entries = useDebugLog();
  if (!DEBUG_BANNER_ENABLED) return null;
  if (entries.length === 0) return null;
  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <View style={styles.banner}>
        {entries.slice(0, 8).map((e) => (
          <Text
            key={e.id}
            numberOfLines={2}
            style={[
              styles.line,
              e.tag === 'Minimap' && { color: '#FFD700' },
              e.tag === 'Sheet' && { color: '#7dd3fc' },
              e.tag === 'Hook' && { color: '#a3e635' },
            ]}>
            {formatTime(e.at)} [{e.tag}] {e.msg}
          </Text>
        ))}
        <Pressable
          onLongPress={clearDebugLog}
          style={styles.clearTarget}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.clearHint}>hold to clear</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 50,
    left: 8,
    right: 8,
    zIndex: 9999,
  },
  banner: {
    backgroundColor: 'rgba(0,0,0,0.82)',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  line: {
    color: '#f0ede8',
    fontSize: 10,
    fontFamily: 'Menlo',
    lineHeight: 13,
  },
  clearTarget: {
    alignSelf: 'flex-end',
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  clearHint: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 9,
    fontFamily: 'Menlo',
  },
});
