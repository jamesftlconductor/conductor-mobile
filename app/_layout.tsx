import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
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
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
