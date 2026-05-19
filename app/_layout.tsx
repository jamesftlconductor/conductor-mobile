import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { ThemeProvider as ConductorThemeProvider } from '@/app/theme';

export const unstable_settings = {
  anchor: '(tabs)',
};

// Hand-rolled class-based ErrorBoundary. Avoids `react-error-boundary`
// because pulling in an external package at the very root of the app
// was itself a candidate for the launch-crash investigation. A class
// component is part of React core, ships with React Native, and has
// no peer-dependency surface area.
type FallbackProps = { error: any; reset: () => void };
class AppErrorBoundary extends React.Component<
  { children: React.ReactNode; Fallback: React.ComponentType<FallbackProps> },
  { error: any }
> {
  state = { error: null as any };
  static getDerivedStateFromError(error: any) {
    return { error };
  }
  componentDidCatch(error: any, info: any) {
    // Surfaces in dev logs and EAS log streams. Production builds can
    // still recover via the Fallback's reset action.
    // eslint-disable-next-line no-console
    console.error('[AppErrorBoundary]', error?.message || error, info?.componentStack);
  }
  reset = () => this.setState({ error: null });
  render() {
    if (this.state.error) {
      const Fallback = this.props.Fallback;
      return <Fallback error={this.state.error} reset={this.reset} />;
    }
    return this.props.children as React.ReactElement;
  }
}

function FallbackComponent({ error, reset }: FallbackProps) {
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
      <TouchableOpacity onPress={reset} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
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
    <AppErrorBoundary Fallback={FallbackComponent}>
      <ConductorThemeProvider>
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
            <Stack.Screen name="missed-cues" options={{ headerShown: false, gestureEnabled: true }} />
          </Stack>
          <StatusBar style="auto" />
        </ThemeProvider>
      </GestureHandlerRootView>
      </ConductorThemeProvider>
    </AppErrorBoundary>
  );
}
