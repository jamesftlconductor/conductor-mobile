import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ErrorBoundary } from 'react-error-boundary';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';

export const unstable_settings = {
  anchor: '(tabs)',
};

// Recovery screen — surfaces when any render below the boundary
// throws. Replaces the blank crash with an actionable restart so a
// user can recover from a transient OTA issue without reinstalling.
function FallbackComponent({
  error,
  resetErrorBoundary,
}: {
  error: any;
  resetErrorBoundary: () => void;
}) {
  const message = error && typeof error.message === 'string' ? error.message : null;
  return (
    <View style={fallbackStyles.container}>
      <Text style={fallbackStyles.title}>Conductor ran into an issue.</Text>
      <Text style={fallbackStyles.body}>Tap to restart.</Text>
      {message ? (
        <Text style={fallbackStyles.detail} numberOfLines={3}>
          {message}
        </Text>
      ) : null}
      <TouchableOpacity onPress={resetErrorBoundary} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
        <Text style={fallbackStyles.cta}>Restart Conductor</Text>
      </TouchableOpacity>
    </View>
  );
}

const fallbackStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f0f',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: { color: '#f5f0eb', fontSize: 18, marginBottom: 8, textAlign: 'center' },
  body: { color: '#5a5855', fontSize: 13, marginBottom: 24 },
  detail: {
    color: '#5a5855',
    fontSize: 10,
    fontFamily: 'Menlo',
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 18,
  },
  cta: { color: '#b8960c', fontSize: 14, fontWeight: '500' },
});

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ErrorBoundary FallbackComponent={FallbackComponent}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="horizon" options={{ headerShown: false, gestureEnabled: true }} />
            <Stack.Screen name="vault" options={{ headerShown: false, gestureEnabled: true }} />
            <Stack.Screen name="compass" options={{ headerShown: false, gestureEnabled: true }} />
            <Stack.Screen name="crew" options={{ headerShown: false, gestureEnabled: true }} />
            <Stack.Screen name="programme" options={{ headerShown: false, gestureEnabled: true }} />
            <Stack.Screen name="signal-filters" options={{ headerShown: false, gestureEnabled: true }} />
            <Stack.Screen name="providers" options={{ headerShown: false, gestureEnabled: true }} />
            <Stack.Screen name="inventory" options={{ headerShown: false, gestureEnabled: true }} />
            <Stack.Screen name="communicate" options={{ headerShown: false, gestureEnabled: true }} />
            <Stack.Screen name="directory" options={{ headerShown: false, gestureEnabled: true }} />
            <Stack.Screen name="junior" options={{ headerShown: false, gestureEnabled: true }} />
            <Stack.Screen name="privacy-dashboard" options={{ headerShown: false, gestureEnabled: true }} />
            <Stack.Screen name="profile-setup" options={{ headerShown: false, gestureEnabled: true }} />
            <Stack.Screen name="recurring-events" options={{ headerShown: false, gestureEnabled: true }} />
          </Stack>
          <StatusBar style="auto" />
        </ThemeProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
