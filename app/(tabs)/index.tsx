import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

export default function TakeoffScreen() {
  const [brief, setBrief] = useState('');
  const [loading, setLoading] = useState(true);
  const [greeting, setGreeting] = useState('');
  const [date, setDate] = useState('');

  useEffect(() => {
    const now = new Date();
    const hour = now.getHours();
    if (hour < 12) setGreeting('Good morning');
    else if (hour < 17) setGreeting('Good afternoon');
    else setGreeting('Good evening');

    setDate(now.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }));

    fetchBrief();
  }, []);

  async function fetchBrief() {
    try {
      const res = await fetch('https://conductor-ivory.vercel.app/api/brief');
      const data = await res.json();
      setBrief(data.brief);
    } catch (err) {
      setBrief("Nothing to report today. You're clear.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.greeting}>{greeting}.</Text>
        <Text style={styles.title}>Takeoff</Text>
      </View>

      <View style={styles.divider} />

      {loading ? (
        <ActivityIndicator color="#f0ede8" style={{ marginTop: 40 }} />
      ) : (
        <View style={styles.briefContainer}>
          <Text style={styles.brief}>{brief}</Text>
        </View>
      )}

      <Text style={styles.timestamp}>{date}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f0f',
  },
  content: {
    padding: 32,
    paddingTop: 80,
    minHeight: '100%',
  },
  header: {
    marginBottom: 32,
  },
  greeting: {
    color: '#5a5855',
    fontSize: 16,
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  title: {
    color: '#f0ede8',
    fontSize: 42,
    fontWeight: '700',
    letterSpacing: -1,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginBottom: 32,
  },
  briefContainer: {
    flex: 1,
  },
  brief: {
    color: '#f0ede8',
    fontSize: 20,
    lineHeight: 32,
    fontWeight: '300',
    letterSpacing: 0.2,
  },
  timestamp: {
    color: '#5a5855',
    fontSize: 12,
    letterSpacing: 0.5,
    marginTop: 48,
    textTransform: 'uppercase',
  },
});