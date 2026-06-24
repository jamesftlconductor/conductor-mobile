// Directory — a swipeable card-deck reference guide for what's in
// Conductor. Static content (24 cards across 6 sections). Reached
// from:
//   - Settings → Conductor → "Directory ?"
//   - "?" button top right of Ground / Hover / Vault / Crew /
//     Horizon / Compass / Journal
//   - Deep-link from the first-brief acknowledgment line.
//
// Entry can target a specific card via ?card=<id> or ?screen=<path>.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useCatchphrase } from '@/hooks/useCatchphrase';
import { useTheme } from '@/app/theme';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { TOKENS } from '@/utils/designTokens';

type DirectoryCard = {
  id: string;
  section: string;
  sectionNumber: number;
  title: string;
  body: string;
  example: string | null;
  screenLink: string | null;
};

// Static personality taglines (The Conductor's voice, ≤8 words) shown
// beneath the matching card's title. Keyed by card id so they render in
// both languages. Compass → the Patterns card, Privacy → the Your Data
// Controls card (the directory has no literal Compass/Privacy card).
const CARD_TAGLINES: Record<string, string> = {
  signals: 'Everything your household needs to know.',
  crew: 'The people The Conductor looks after.',
  vault: 'Nothing lapses. Nothing forgotten.',
  horizon: 'Further out than the brief. Closer than you think.',
  patterns: 'How your household actually runs.',
  maintenance: 'Your home, ahead of the season.',
  network: 'The households you trust.',
  controls: 'Your data. Your call. Always.',
};

const DIRECTORY_CARDS_EN: DirectoryCard[] = [
  // ── Section 1 — The Basics ──
  { id: 'brief', section: 'The Basics', sectionNumber: 1, title: 'The Brief',
    body: "Every morning at 7am Conductor delivers a brief — 3 to 5 sentences about what matters most in your household today. Not everything. Not a list. Just what you actually need to know, said calmly and clearly. The brief gets smarter every day as Conductor learns your household's patterns.",
    example: "\"You have two subscription renewals this week and Mia has a field trip Monday. The Paris trip looks ready.\"",
    screenLink: '/' },
  { id: 'radar', section: 'The Basics', sectionNumber: 1, title: 'The Radar',
    body: "The Hover screen shows your household's signals as dots rotating on three rings. The inner ring needs your attention soon. The middle ring is approaching. The outer ring is on the horizon. Tap any dot to see details and take action.",
    example: "A package arriving today sits on the inner ring. A subscription renewal in three weeks sits on the outer ring.",
    screenLink: '/hover' },
  { id: 'signals', section: 'The Basics', sectionNumber: 1, title: 'Signals',
    body: "A signal is anything in your household that needs awareness or action — a delivery, a deadline, a service appointment, a renewal. Conductor finds signals in your Gmail automatically. You can also add them manually. Signals move through three states: incoming, active, and resolved.",
    example: "When you tap Rest on a signal, it moves to resolved and contributes to your household streak.",
    screenLink: '/hover' },
  { id: 'pulse', section: 'The Basics', sectionNumber: 1, title: 'The Pulse',
    body: "The Pulse is a single sentence each morning synthesizing your health, the weather, and your signal load into something true about today. It lives below your greeting on the Ground screen. Tap it to expand and see what Conductor is synthesizing.",
    example: "\"The humidity has opinions today — two urgent things need your attention before the heat builds.\"",
    screenLink: '/' },

  // ── Section 2 — Your Household ──
  { id: 'crew', section: 'Your Household', sectionNumber: 2, title: 'Crew',
    body: "Crew is everyone in your household — partners, children, pets. Each crew member has their own bio with schedule, health details, and attributed signals. When a signal belongs to a specific person, Conductor attributes it to them and narrates it that way in the brief.",
    example: "\"Mia's prescription needs refilling this week.\" — because the signal is attributed to Mia.",
    screenLink: '/crew' },
  { id: 'vault', section: 'Your Household', sectionNumber: 2, title: 'Vault',
    body: "The Vault is your household's permanent record — insurance policies, subscriptions, warranties, registrations, leases, and deadlines. Conductor populates it from your Gmail automatically. You can also scan physical documents or add items manually.",
    example: "Your car registration renewal lives in the Vault. Conductor surfaces it before it lapses.",
    screenLink: '/vault' },
  { id: 'horizon', section: 'Your Household', sectionNumber: 2, title: 'The Horizon',
    body: "The Horizon shows everything beyond the next two weeks — organized into three temporal sections: Coming Up, Further Out, and On the Edge. Tap Noted to acknowledge something without resolving it. Items move from The Horizon into the brief as they get closer.",
    example: "Your Paris trip sits in Coming Up. Your annual insurance renewal sits in Further Out.",
    screenLink: '/horizon' },
  { id: 'programme', section: 'Your Household', sectionNumber: 2, title: 'The Programme',
    body: "The Programme is a 14-day timeline showing everything Conductor is watching — signals, crew events, vault deadlines, and calendar events all on one view. It's the unified household calendar that doesn't exist anywhere else.",
    example: "Monday shows Mia's field trip, Tuesday shows a delivery arriving, Thursday shows a service appointment.",
    screenLink: '/programme' },
  { id: 'inventory', section: 'Your Household', sectionNumber: 2, title: 'Home Inventory',
    body: "Home Inventory is where you tell Conductor about your home's systems — roof, HVAC, water heater, vehicles, appliances. The more you fill in, the smarter the maintenance plan becomes. Conductor can also scan appliance labels to populate fields automatically.",
    example: "Tell Conductor your roof was installed in 2009 and it will surface an inspection reminder before hurricane season.",
    screenLink: '/inventory' },

  // ── Section 3 — Intelligence ──
  { id: 'ask', section: 'Intelligence', sectionNumber: 3, title: 'The Conductor',
    body: "Ask The Conductor anything about your household — what's coming up, what things cost, who you've used before, how your week looks. The Conductor answers from your actual household data, not general knowledge. The more Conductor knows about your home, the better the answers.",
    example: "\"Is $450 reasonable for HVAC service in Fort Lauderdale?\" — The Conductor knows your market and your service history.",
    screenLink: '/' },
  { id: 'synthesis', section: 'Intelligence', sectionNumber: 3, title: 'Synthesis',
    body: "Every morning Conductor considers your health data, the weather, and your signal load simultaneously before saying anything. This is the synthesis layer — the thing that makes the brief feel like it was written by someone who knows you, not assembled from data.",
    example: "Bad sleep plus high humidity plus a busy signal day produces: 'Stay ahead of hydration today.'",
    screenLink: '/' },
  { id: 'patterns', section: 'Intelligence', sectionNumber: 3, title: 'Patterns',
    body: "Over time Conductor learns how your household operates — which signals you resolve quickly, which ones you let sit, what days are typically busy, what seasonal patterns recur. After 90 days the brief voice reflects this knowledge naturally.",
    example: "After three months Conductor knows your Amazon orders typically arrive in 2 days — so a 5-day delay is notable.",
    screenLink: '/' },
  { id: 'network', section: 'Intelligence', sectionNumber: 3, title: 'The Network',
    body: "The Network connects your household to family households you trust. You choose what to share — from emergency-only awareness to full signal visibility. Connected households appear quietly in your brief when something needs attention.",
    example: "\"Your parents' household has a deadline approaching this week.\" — surfaced because you're connected.",
    screenLink: '/network' },

  // ── Section 4 — Planning ──
  { id: 'maintenance', section: 'Planning', sectionNumber: 4, title: 'Home Maintenance Plan',
    body: "Once Conductor knows your home's systems, it generates an annual maintenance schedule with Fort Lauderdale seasonal timing and real cost ranges. Each item can be added to your signal radar with one tap. The plan updates annually.",
    example: "\"HVAC tune-up — due before June. Book now — South Florida HVAC fills up fast before summer.\"",
    screenLink: '/maintenance' },
  { id: 'transition', section: 'Planning', sectionNumber: 4, title: 'Life Transitions',
    body: "When something big changes — a new baby, a new home, a health diagnosis, a job change — Conductor adjusts. Tell it what happened and it seeds the right Vault items, adjusts its tone, and watches for the deadlines specific to that transition.",
    example: "A new home transition seeds 14 Vault items automatically — from mail forwarding to the first property tax payment.",
    screenLink: '/transition' },
  { id: 'caught', section: 'Planning', sectionNumber: 4, title: 'Caught Moments',
    body: "When Conductor catches something that was close to slipping — a deadline handled within 72 hours of lapsing, a conflict resolved, a birthday remembered — it acknowledges it. These are recorded in your Memory Journal and surface in the Week in Review.",
    example: "\"Conductor caught the vehicle registration before it lapsed — handled with 2 days to spare.\"",
    screenLink: '/journal' },
  { id: 'weekinreview', section: 'Planning', sectionNumber: 4, title: 'Week in Review',
    body: "Every Sunday evening the Clearance brief includes a Week in Review — a warm, honest paragraph about how the household did this week. Signals handled, deadlines caught, streak status. It gets more personal as Conductor knows you better.",
    example: "\"Seven signals this week. Six handled, one carried forward. The streak is holding at 12 days.\"",
    screenLink: '/' },

  // ── Section 5 — Communication ──
  { id: 'notifications', section: 'Communication', sectionNumber: 5, title: 'Notifications',
    body: "Conductor sends three types of push notifications — the morning Takeoff at 7am, the evening Clearance at 9pm, and follow-ups when a signal's ETA passes without action. Midday check-ins are optional and off by default.",
    example: "A follow-up fires one hour after your HVAC appointment window passes: \"Your appointment window just passed — did it happen?\"",
    screenLink: '/settings' },
  { id: 'sms', section: 'Communication', sectionNumber: 5, title: 'SMS Updates',
    body: "Conductor can text anyone connected to your household — family members, contractors, neighbors — whether they have the app or not. They can reply with simple keywords (DONE, YES, NO) and Conductor updates the signal automatically.",
    example: "Text your contractor: \"Confirming your appointment Thursday at 2pm. Reply CONFIRM to confirm.\"",
    screenLink: '/communicate' },
  { id: 'relay', section: 'Communication', sectionNumber: 5, title: 'Signal Relay',
    body: "Household members — including children with Conductor Junior — can add signals directly. A child can tell Conductor they need school supplies and it appears immediately in the parent's brief, attributed to that child.",
    example: "Mia adds \"Need colored pencils by Friday\" → parent gets: \"[MIA ADDED] School supplies needed by Friday\"",
    screenLink: '/junior' },

  // ── Section 6 — Privacy & Data ──
  { id: 'reads', section: 'Privacy & Data', sectionNumber: 6, title: 'What Conductor Reads',
    body: "Conductor reads your Gmail to find signals, your Google Calendar for conflict detection, and Apple Health for synthesis. It never reads emails that don't generate signals and never stores email content — only the structured signal it extracts.",
    example: "An Amazon shipping email becomes a delivery signal. The email content is immediately discarded.",
    screenLink: '/privacy-dashboard' },
  { id: 'never', section: 'Privacy & Data', sectionNumber: 6, title: 'What Conductor Never Does',
    body: "Conductor never sells your data. Never shares your household information without explicit permission. Never reads emails that don't generate signals. Never stores health data on external servers. The brief is generated from your data — not from data about other households.",
    example: "Your household's signals are yours. They never train models or inform other households without your permission.",
    screenLink: '/privacy-dashboard' },
  { id: 'network-privacy', section: 'Privacy & Data', sectionNumber: 6, title: 'The Network and Privacy',
    body: "Network connections only see what you explicitly share with them. Permission levels are set by you and can be changed or revoked at any time. Watchful connections see only signal load. Open connections see signal descriptions. Emergency-only connections see nothing unless something urgent arises.",
    example: "Your parents on Watchful level see: \"2 signals in motion.\" Nothing more unless you change it.",
    screenLink: '/network' },
  { id: 'controls', section: 'Privacy & Data', sectionNumber: 6, title: 'Your Data Controls',
    body: "You can export all your household data as a JSON file at any time. You can delete your account and all associated data permanently. You can see exactly which emails generated which signals in the Privacy Dashboard. Your data is yours.",
    example: "Settings → Privacy & Data → Export my data downloads everything Conductor knows about your household.",
    screenLink: '/privacy-dashboard' },
];

// 24 Spanish translations. Same id + screenLink as EN so navigation
// deep-links continue to work in either language. Section labels are
// localized; the SECTION_PILLS_ES below matches.
const DIRECTORY_CARDS_ES: DirectoryCard[] = [
  { id: 'brief', section: 'Lo Básico', sectionNumber: 1, title: 'El Resumen',
    body: 'Cada mañana a las 7am Conductor entrega un resumen — 3 a 5 oraciones sobre lo más importante en tu hogar hoy. No todo. No una lista. Solo lo que necesitas saber, dicho con calma y claridad. El resumen mejora cada día mientras Conductor aprende los patrones de tu hogar.',
    example: '"Tienes dos renovaciones de suscripción esta semana y Mia tiene una excursión el lunes."', screenLink: '/' },
  { id: 'radar', section: 'Lo Básico', sectionNumber: 1, title: 'El Radar',
    body: 'La pantalla Hover muestra tus señales como puntos en tres anillos giratorios. El anillo interior necesita atención hoy. El anillo del medio se acerca. El anillo exterior está en el horizonte. Toca cualquier punto para ver detalles.',
    example: 'Un paquete que llega hoy está en el anillo interior. Una renovación en tres semanas está en el anillo exterior.', screenLink: '/hover' },
  { id: 'signals', section: 'Lo Básico', sectionNumber: 1, title: 'Señales',
    body: 'Una señal es cualquier cosa en tu hogar que necesita atención o acción — una entrega, un plazo, una cita de servicio, una renovación. Conductor encuentra señales en tu Gmail automáticamente. Puedes agregarlas manualmente. Las señales pasan de entrante a activa a resuelta.',
    example: 'Cuando tocas Descansar en una señal, se resuelve y contribuye a tu racha del hogar.', screenLink: '/hover' },
  { id: 'pulse', section: 'Lo Básico', sectionNumber: 1, title: 'El Pulso',
    body: 'El Pulso sintetiza tu salud, el clima y la carga de señales en una oración sobre el día de hoy. Vive debajo de tu saludo en la pantalla principal. Tócalo para expandir y ver qué está considerando Conductor.',
    example: '"La humedad tiene opiniones hoy — dos cosas urgentes necesitan tu atención antes de que aumente el calor."', screenLink: '/' },
  { id: 'crew', section: 'Tu Hogar', sectionNumber: 2, title: 'Equipo',
    body: 'Equipo es todos en tu hogar — parejas, hijos, mascotas. Cada miembro tiene su propia bio con horario, detalles de salud y señales atribuidas. Cuando una señal pertenece a una persona específica, Conductor la atribuye a ellos y lo narra así en el resumen.',
    example: '"La receta de Mia necesita renovarse esta semana." — porque la señal está atribuida a Mia.', screenLink: '/crew' },
  { id: 'vault', section: 'Tu Hogar', sectionNumber: 2, title: 'Bóveda',
    body: 'La Bóveda es el registro permanente de tu hogar — pólizas de seguro, suscripciones, garantías, registros, arrendamientos y plazos. Conductor la llena desde Gmail automáticamente. También puedes escanear documentos físicos o agregar elementos manualmente.',
    example: 'La renovación del registro de tu auto vive en la Bóveda. Conductor la muestra antes de que venza.', screenLink: '/vault' },
  { id: 'horizon', section: 'Tu Hogar', sectionNumber: 2, title: 'El Horizonte',
    body: 'El Horizonte muestra todo más allá de las próximas dos semanas — organizado en Próximamente, Más Adelante y En el Borde. Toca Anotado para reconocer algo sin resolverlo. Los elementos se mueven al resumen cuando se acercan.',
    example: 'Tu viaje a París está en Próximamente. Tu renovación anual de seguro está en Más Adelante.', screenLink: '/horizon' },
  { id: 'programme', section: 'Tu Hogar', sectionNumber: 2, title: 'El Programa',
    body: 'El Programa es una línea de tiempo de 14 días que muestra todo lo que Conductor está vigilando — señales, eventos del equipo, plazos de la bóveda y eventos del calendario en una sola vista. El calendario unificado del hogar que no existe en ningún otro lugar.',
    example: 'El lunes muestra una entrega. El martes muestra una cita de servicio. El jueves muestra la práctica de fútbol de Mia.', screenLink: '/programme' },
  { id: 'inventory', section: 'Tu Hogar', sectionNumber: 2, title: 'Inventario del Hogar',
    body: 'El Inventario del Hogar es donde le dices a Conductor sobre los sistemas de tu hogar — techo, HVAC, calentador de agua, vehículos, electrodomésticos. Cuanto más llenes, más inteligente se vuelve el plan de mantenimiento.',
    example: 'Dile a Conductor que tu techo fue instalado en 2009 y mostrará un recordatorio de inspección antes de la temporada de huracanes.', screenLink: '/inventory' },
  { id: 'ask', section: 'Inteligencia', sectionNumber: 3, title: 'Pregúntale a Conductor',
    body: 'Pregúntale a Conductor cualquier cosa — sobre tu hogar, sobre el producto, o comandos como "abrir mi bóveda" o "activar Face ID". Conductor responde desde los datos reales de tu hogar y puede navegar la app o cambiar configuraciones en tu nombre.',
    example: '"¿Es razonable $450 por servicio de HVAC?" — Conductor conoce tu mercado y tu historial de servicio.', screenLink: '/' },
  { id: 'synthesis', section: 'Inteligencia', sectionNumber: 3, title: 'Síntesis',
    body: 'Cada mañana Conductor considera tus datos de salud, el clima y tu carga de señales simultáneamente antes de decir algo. Esta capa de síntesis es lo que hace que el resumen se sienta como si hubiera sido escrito por alguien que te conoce.',
    example: 'Mal sueño más alta humedad más un día de señales ocupado produce: "Mantente hidratado hoy."', screenLink: '/' },
  { id: 'patterns', section: 'Inteligencia', sectionNumber: 3, title: 'Patrones',
    body: 'Con el tiempo Conductor aprende cómo opera tu hogar — qué señales resuelves rápido, qué días son típicamente ocupados, qué patrones estacionales se repiten. Después de 90 días la voz del resumen refleja este conocimiento naturalmente.',
    example: 'Después de tres meses Conductor sabe que tus pedidos de Amazon llegan en 2 días — así que un retraso de 5 días es notable.', screenLink: '/' },
  { id: 'network', section: 'Inteligencia', sectionNumber: 3, title: 'La Red',
    body: 'La Red conecta tu hogar con hogares familiares de confianza. Tú eliges qué compartir — desde solo conciencia de emergencia hasta visibilidad completa de señales. Los hogares conectados aparecen discretamente en tu resumen cuando algo necesita atención.',
    example: '"El hogar de tus padres tiene un plazo que se acerca esta semana." — mostrado porque están conectados.', screenLink: '/network' },
  { id: 'maintenance', section: 'Planificación', sectionNumber: 4, title: 'Plan de Mantenimiento',
    body: 'Una vez que Conductor conoce los sistemas de tu hogar, genera un programa de mantenimiento anual con tiempos estacionales y rangos de costos reales para tu mercado. Cada elemento se puede agregar a tu radar de señales con un toque.',
    example: '"Mantenimiento de HVAC antes de junio. Reserva ahora — la demanda en South Florida aumenta en verano."', screenLink: '/maintenance' },
  { id: 'transitions', section: 'Planificación', sectionNumber: 4, title: 'Transiciones de Vida',
    body: 'Cuando algo grande cambia — un nuevo bebé, casa nueva, diagnóstico de salud, cambio de trabajo — díselo a Conductor. Siembra los elementos correctos en la Bóveda, ajusta su tono y vigila los plazos específicos de la transición por 90 días.',
    example: 'Una transición de casa nueva siembra automáticamente 14 elementos en la Bóveda — desde el cambio de dirección postal hasta el primer pago de impuestos.', screenLink: '/transition' },
  { id: 'caught', section: 'Planificación', sectionNumber: 4, title: 'Momentos Atrapados',
    body: 'Cuando Conductor atrapa algo cerca de escaparse — un plazo manejado dentro de 72 horas antes de vencer — lo reconoce. Estos se registran en tu Diario de Memoria y aparecen en la Revisión de la Semana.',
    example: '"Conductor atrapó el registro del vehículo antes de que venciera — manejado con 2 días de sobra."', screenLink: '/journal' },
  { id: 'weekreview', section: 'Planificación', sectionNumber: 4, title: 'Revisión de la Semana',
    body: 'Cada domingo por la noche el resumen de Despeje incluye una Revisión de la Semana — un párrafo cálido y honesto sobre cómo le fue al hogar esta semana. Señales manejadas, plazos atrapados, estado de racha. Se vuelve más personal mientras Conductor te conoce mejor.',
    example: '"Siete señales esta semana. Seis manejadas, una trasladada. La racha se mantiene en 12 días."', screenLink: '/' },
  { id: 'notifications', section: 'Comunicación', sectionNumber: 5, title: 'Notificaciones',
    body: 'Conductor envía tres tipos de notificaciones push — Despegue matutino a las 7am, Despeje vespertino a las 9pm, y seguimientos cuando pasa el ETA de una señal. Los controles de mediodía son opcionales y están desactivados por defecto.',
    example: 'Un seguimiento se activa una hora después de que pasa tu ventana de HVAC: "Tu ventana de cita acaba de pasar — ¿ocurrió?"', screenLink: '/settings' },
  { id: 'sms', section: 'Comunicación', sectionNumber: 5, title: 'Actualizaciones por SMS',
    body: 'Conductor puede enviar mensajes de texto a cualquier persona conectada a tu hogar — familiares, contratistas — tengan o no la app. Responden con palabras clave simples (LISTO, SÍ, NO) y Conductor actualiza la señal automáticamente.',
    example: 'Texto a tu contratista: "Confirmando el jueves a las 2pm. Responde CONFIRMAR para confirmar." Responden. La señal se actualiza.', screenLink: '/communicate' },
  { id: 'relay', section: 'Comunicación', sectionNumber: 5, title: 'Relevo de Señales',
    body: 'Los miembros del hogar — incluidos los niños con Conductor Junior — pueden agregar señales directamente hablando o escribiendo. Un niño puede decir que necesita útiles escolares y aparece inmediatamente en el resumen de los padres atribuido a ese niño.',
    example: 'Mia dice "necesito lápices de colores para el viernes" → resumen de padres: "[MIA AGREGÓ] Útiles escolares necesarios para el viernes"', screenLink: '/junior' },
  { id: 'reads', section: 'Privacidad y Datos', sectionNumber: 6, title: 'Qué Lee Conductor',
    body: 'Conductor lee tu Gmail para encontrar señales, tu Google Calendar para detectar conflictos, y Apple Health para síntesis. Nunca lee correos que no generan señales y nunca almacena contenido de correo — solo la señal que extrae.',
    example: 'Un correo de envío de Amazon se convierte en una señal de entrega. El contenido del correo se descarta inmediatamente.', screenLink: '/privacy-dashboard' },
  { id: 'never', section: 'Privacidad y Datos', sectionNumber: 6, title: 'Lo Que Conductor Nunca Hace',
    body: 'Conductor nunca vende tus datos. Nunca comparte la información de tu hogar sin permiso explícito. Nunca lee correos que no generan señales. Nunca almacena datos de salud sin cifrar. Tu resumen se genera desde tus datos — no desde datos de otros hogares.',
    example: 'Tus señales son tuyas. Nunca entrenan modelos ni informan a otros hogares sin tu permiso.', screenLink: '/privacy-dashboard' },
  { id: 'network-privacy', section: 'Privacidad y Datos', sectionNumber: 6, title: 'Privacidad de La Red',
    body: 'Las conexiones de La Red solo ven lo que compartes explícitamente. Los niveles de permiso los estableces tú y son revocables en cualquier momento. Las conexiones vigilantes solo ven la carga de señales. Las conexiones abiertas ven descripciones de señales.',
    example: 'Tus padres en nivel Vigilante ven: "2 señales en movimiento." Nada más a menos que lo cambies.', screenLink: '/network' },
  { id: 'controls', section: 'Privacidad y Datos', sectionNumber: 6, title: 'Tus Controles de Datos',
    body: 'Puedes exportar todos los datos de tu hogar como un archivo JSON en cualquier momento. Puedes eliminar tu cuenta y todos los datos asociados permanentemente. Puedes ver exactamente qué correos generaron qué señales en el Panel de Privacidad.',
    example: 'Tu Casa → Privacidad y Datos → Exportar mis datos descarga todo lo que Conductor sabe sobre tu hogar.', screenLink: '/privacy-dashboard' },
];

const SECTION_PILLS_EN: { label: string; section: string | 'all' }[] = [
  { label: 'All', section: 'all' },
  { label: 'Basics', section: 'The Basics' },
  { label: 'Household', section: 'Your Household' },
  { label: 'Intelligence', section: 'Intelligence' },
  { label: 'Planning', section: 'Planning' },
  { label: 'Communication', section: 'Communication' },
  { label: 'Privacy', section: 'Privacy & Data' },
];

const SECTION_PILLS_ES: { label: string; section: string | 'all' }[] = [
  { label: 'Todo', section: 'all' },
  { label: 'Lo Básico', section: 'Lo Básico' },
  { label: 'Tu Hogar', section: 'Tu Hogar' },
  { label: 'Inteligencia', section: 'Inteligencia' },
  { label: 'Planificación', section: 'Planificación' },
  { label: 'Comunicación', section: 'Comunicación' },
  { label: 'Privacidad', section: 'Privacidad y Datos' },
];

// Map screenLink → friendly name for the "Open X →" link.
const SCREEN_NAMES: Record<string, string> = {
  '/': 'Ground',
  '/hover': 'Hover',
  '/vault': 'Vault',
  '/crew': 'Crew',
  '/horizon': 'Horizon',
  '/programme': 'Programme',
  '/inventory': 'Home Inventory',
  '/maintenance': 'Maintenance plan',
  '/transition': 'Life Transitions',
  '/journal': 'Memory Journal',
  '/network': 'Network',
  '/communicate': 'Email composer',
  '/junior': 'Conductor Junior',
  '/settings': 'Settings',
  '/privacy-dashboard': 'Privacy Dashboard',
};

// Per-card catchphrase — extracted so the FlatList renderItem can
// call useCatchphrase. Renders below the SECTION label and above
// the card title. Empty string from the hook (unmapped feature)
// renders nothing.
function CardCatchphrase({ featureId }: { featureId: string }) {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const phrase = useCatchphrase(featureId);
  if (!phrase) return null;
  return <Text style={styles.cardCatchphrase}>{phrase}</Text>;
}

export default function DirectoryScreen() {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const params = useLocalSearchParams<{ card?: string; screen?: string }>();
  const { width } = useWindowDimensions();
  const cardWidth = width - 40; // 20px peek on each side
  const listRef = useRef<FlatList<DirectoryCard>>(null);

  // Language pick — read AsyncStorage 'conductorLanguage' on mount.
  // Default English. Defensive try/catch so storage failure can't
  // crash the screen.
  const [language, setLanguage] = useState<'en' | 'es'>('en');
  useEffect(() => {
    (async () => {
      try {
        const v = await AsyncStorage.getItem('conductorLanguage');
        if (v === 'es') setLanguage('es');
      } catch { /* fall through to EN */ }
    })();
  }, []);
  const CARDS = language === 'es' ? DIRECTORY_CARDS_ES : DIRECTORY_CARDS_EN;
  const SECTION_PILLS = language === 'es' ? SECTION_PILLS_ES : SECTION_PILLS_EN;
  const titleLabel = language === 'es' ? 'Directorio' : 'Directory';
  const subtitleLabel = language === 'es' ? 'Tu guía de Conductor' : 'Your guide to Conductor';
  const counterOf = language === 'es' ? 'de' : 'of';
  const openWord = language === 'es' ? 'Abrir' : 'Open';

  const [activeIndex, setActiveIndex] = useState(0);

  // Resolve an initial card from params on mount.
  const initialIndex = useMemo(() => {
    if (params?.card) {
      const idx = CARDS.findIndex((c) => c.id === params.card);
      if (idx >= 0) return idx;
    }
    if (params?.screen) {
      const idx = CARDS.findIndex((c) => c.screenLink === params.screen);
      if (idx >= 0) return idx;
    }
    return 0;
  }, [params?.card, params?.screen]);

  useEffect(() => {
    if (initialIndex > 0) {
      setActiveIndex(initialIndex);
      // Defer scrollToIndex past first layout pass.
      setTimeout(() => {
        listRef.current?.scrollToIndex({ index: initialIndex, animated: false });
      }, 60);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    const i = Math.round(x / cardWidth);
    if (i !== activeIndex && i >= 0 && i < CARDS.length) {
      setActiveIndex(i);
    }
  }, [cardWidth, activeIndex]);

  function jumpToSection(section: string | 'all') {
    let target = 0;
    if (section !== 'all') {
      const idx = CARDS.findIndex((c) => c.section === section);
      if (idx >= 0) target = idx;
    }
    setActiveIndex(target);
    listRef.current?.scrollToIndex({ index: target, animated: true });
  }

  const activeCard = CARDS[activeIndex];
  const activeSectionCards = CARDS.filter((c) => c.section === activeCard?.section);
  const positionInSection = activeSectionCards.findIndex((c) => c.id === activeCard?.id);

  return (
    <View style={styles.container}>
      <ScreenHeader
        title={titleLabel}
        subtitle={subtitleLabel}
        rightAction={
          <Text style={styles.counter}>
            {activeIndex + 1} {counterOf} {CARDS.length}
          </Text>
        }
      />
      {/* returnLabel still used by Spanish localization fallback —
          the ScreenHeader's back button uses the default "← Return"
          string. To restore Spanish, pass a custom onBack handler
          and intercept rendering; deferred since the back button is
          the only remaining language-aware string. */}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pillRow}>
        {SECTION_PILLS.map((p) => {
          const isActive =
            p.section === 'all'
              ? false
              : activeCard?.section === p.section;
          return (
            <TouchableOpacity
              key={p.label}
              onPress={() => jumpToSection(p.section)}
              style={[styles.pill, isActive && styles.pillActive]}>
              <Text style={[styles.pillText, isActive && styles.pillTextActive]}>
                {p.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <FlatList
        ref={listRef}
        data={CARDS}
        keyExtractor={(c) => c.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        snapToInterval={cardWidth}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: 20 }}
        getItemLayout={(_, index) => ({
          length: cardWidth,
          offset: cardWidth * index,
          index,
        })}
        renderItem={({ item }) => (
          <View style={[styles.cardOuter, { width: cardWidth }]}>
            <View style={styles.card}>
              <Text style={styles.cardSection}>{item.section.toUpperCase()}</Text>
              <CardCatchphrase featureId={item.id} />
              <Text style={styles.cardTitle}>{item.title}</Text>
              {CARD_TAGLINES[item.id] ? (
                <Text style={styles.cardTagline}>{CARD_TAGLINES[item.id]}</Text>
              ) : null}
              <View style={styles.brassDivider} />
              <Text style={styles.cardBody}>{item.body}</Text>
              {item.example ? (
                <Text style={styles.cardExample}>{item.example}</Text>
              ) : null}
              {item.screenLink ? (
                <TouchableOpacity
                  onPress={() => {
                    router.back();
                    setTimeout(() => router.push(item.screenLink as any), 30);
                  }}
                  style={styles.openLinkRow}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.openLink}>
                    {openWord} {SCREEN_NAMES[item.screenLink] || item.screenLink} →
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        )}
      />

      <View style={styles.dotsRow}>
        {activeSectionCards.map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i === positionInSection && styles.dotActive]}
          />
        ))}
      </View>
    </View>
  );
}

type ThemeColors = {
  background: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  inputBackground: string;
};

function accentRgba(accentColor: string, opacity: number): string {
  const hex = accentColor.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

function makeStyles(theme: ThemeColors, accentColor: string) {
  const BG = theme.background;
  const OFF_WHITE = theme.text;
  const MUTED = theme.muted;
  const FAINT = theme.muted;
  const BRASS = accentColor;
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  headerWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  topBack: { paddingVertical: 6, paddingHorizontal: 4 },
  topBackText: { color: MUTED, ...TOKENS.type.secondary },
  counter: { color: MUTED, ...TOKENS.type.label, letterSpacing: 1 },

  title: {
    color: OFF_WHITE,
    ...TOKENS.type.header,
    paddingHorizontal: 20,
    marginTop: 8,
  },
  subtitle: {
    color: MUTED,
    ...TOKENS.type.secondary,
    marginTop: 4,
    paddingHorizontal: 20,
  },

  pillRow: {
    paddingHorizontal: 20,
    paddingVertical: 18,
    gap: 8,
  },
  pill: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 18,
    minHeight: 44,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  pillActive: {
    borderColor: BRASS,
    backgroundColor: accentRgba(accentColor, 0.10),
  },
  pillText: { color: FAINT, ...TOKENS.type.secondary },
  pillTextActive: { color: BRASS, fontWeight: '600' },

  cardOuter: { paddingHorizontal: 8 },
  card: {
    flex: 1,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    borderRadius: TOKENS.card.borderRadius,
    padding: 24,
    minHeight: 360,
  },
  cardSection: {
    color: MUTED,
    ...TOKENS.type.label,
  },
  cardCatchphrase: {
    color: BRASS,
    ...TOKENS.type.secondary,
    fontSize: 11,
    fontStyle: 'italic',
    letterSpacing: 0.5,
    marginTop: 6,
  },
  cardTitle: {
    color: OFF_WHITE,
    fontSize: 24,
    fontWeight: '700',
    marginTop: 8,
  },
  cardTagline: {
    color: accentColor,
    fontSize: 13,
    fontStyle: 'italic',
    letterSpacing: 0.2,
    marginTop: 6,
  },
  brassDivider: {
    height: 1,
    backgroundColor: accentRgba(accentColor, 0.45),
    marginVertical: 12,
  },
  cardBody: {
    color: OFF_WHITE,
    ...TOKENS.type.body,
    lineHeight: 22,
  },
  cardExample: {
    color: MUTED,
    ...TOKENS.type.secondary,
    fontStyle: 'italic',
    marginTop: 12,
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderLeftColor: BRASS,
    lineHeight: 20,
  },
  openLinkRow: { marginTop: 18, minHeight: 44, justifyContent: 'center' },
  openLink: { color: BRASS, ...TOKENS.type.secondary, letterSpacing: 0.4, fontWeight: '500' },

  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 24,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.border,
  },
  dotActive: {
    backgroundColor: BRASS,
    width: 18,
  },
  });
}
