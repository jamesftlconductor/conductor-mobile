# Conductor App Icon Specifications

Twelve monthly icons + one founding-household exclusive. Each 1024×1024 PNG, named `icon-{month}.png` and `icon-founding.png`. Final assets land in this directory.

Shared design grammar (all icons):
- Centered three-arc minimap motif (Conductor's identity glyph)
- Single baton overlaid on the arcs (position varies per icon)
- Solid color background, no gradients on the background itself
- Arc and baton colors vary; backgrounds vary; the silhouette stays constant so the app reads as Conductor across all 13

---

## january
- **Background:** `#0D1B2A` deep midnight blue
- **Arcs:** brass `#b8960c` fading to gold `#d4af37`
- **Baton:** warm cream `#FDF8F0`, pointing forward at 12 o'clock
- **Feel:** clean slate, new year energy, radar ready

## february
- **Background:** `#2D1B2E` deep burgundy
- **Arcs:** rose gold `#B76E79` → warm gold `#d4af37`
- **Baton:** warm cream `#FDF8F0`
- **Feel:** warmest icon of the year. Peak snowbird season. Perfect weather.

## march
- **Background:** `#0D2137` deep ocean teal
- **Arcs:** brass `#b8960c` with slight turquoise tint
- **Baton:** dynamic angle suggesting motion
- **Feel:** spring break approaching. Things are changing.

## april
- **Background:** `#1A2E1A` deep sage
- **Arcs:** brass `#b8960c`
- **Baton:** forest green `#2D6A4F`
- **Feel:** growth, spring, life returning.

## may
- **Background:** `#1A4A4A` deep teal (Vice energy)
- **Arcs:** gradient pink `#FF6B9D` → light blue `#87CEEB`
- **Baton:** white `#FFFFFF`
- **Feel:** Miami Vice. Tortuga Festival. Peak South Florida.
- **Design note:** the city-jersey moment — most unexpected icon of the year.

## june
- **Background:** `#1C1C1C` deep charcoal
- **Arcs:** amber-orange `#E8800A`, with a subtle spiral quality to the arc spacing
- **Baton:** slightly angled — wind-direction suggestion
- **Feel:** hurricane season opens. The Conductor is watching the Atlantic.

## july
- **Background:** `#8B2500` deep coral
- **Arcs:** burning gold `#FFB347`
- **Baton:** white `#FFFFFF`
- **Feel:** maximum heat. Full South Florida summer. The humidity has opinions.

## august
- **Background:** `#0A1628` deep navy
- **Arcs:** electric teal `#00CED1`
- **Baton:** vertical — conductor at attention
- **Feel:** storm season peak. The Conductor at its most vigilant.

## september
- **Background:** `#2D1F00` warm amber-brown
- **Arcs:** deep brass `#8B6914`
- **Baton:** standard position
- **Feel:** back to school. Fall beginning. Routines reasserting.

## october
- **Background:** `#0A1628` deep navy (the Atlantic at peak season)
- **Arcs:** pure gold `#FFD700`
- **Baton:** confident angle
- **Feel:** Boat Show month. Fort Lauderdale alive. The city's biggest event.

## november
- **Background:** `#2D1800` harvest brown-gold
- **Arcs:** harvest gold `#DAA520`
- **Baton:** cream `#FDF8F0`
- **Feel:** gratitude. Thanksgiving. Snowbirds returning. Household gathering.

## december — Christmas
- **Background:** `#1A3D2B` deep Christmas forest green
- **Arcs:** warm gold `#FFD700` with subtle shimmer
- **Baton:** white `#FFFFFF`, angled upward at the celebratory position — the conductor raising the baton for the finale
- **Accent:** small gold star at baton tip — subtle, not literal
- **Feel:** Christmas. The year's finale. Warm, celebratory, unmistakably December. The green and gold do the work. The star seals it.

## founding — exclusive
- **Background:** `#0f0f0f` main app dark (matches app interior)
- **Arcs:** brass `#b8960c` standard
- **Baton:** slightly elevated angle — 11 o'clock position vs. standard 10 o'clock
- **Accent:** small ⚡ subtly incorporated near the outer arc
- **Feel:** the original. The home uniform. Founding households only. The baton position is the tell — subtle enough that only founding households recognize it.

---

## Placeholder PNGs

Until the designer delivers final assets, this directory should contain 13 solid-color 1024×1024 PNG placeholders named `icon-{month}.png` and `icon-founding.png`, using the **Background** hex from each spec above. The mobile selector and the launch-time suggestion sheet render these placeholders directly until real assets land.

## Switching the actual app icon

Setting the OS-level app icon at runtime is **not** an OTA-safe operation on iOS or Android — it requires a native module (`expo-dynamic-app-icon` or `react-native-change-icon`) and a fresh EAS build with `CFBundleAlternateIcons` declared in `Info.plist` for every alternate icon.

What ships OTA:
- The selector UI, the suggestion sheet, the Settings entry row
- The `currentIcon` / `lastIconMonth` preferences in AsyncStorage
- The launch-time suggestion logic
- The `iconNote` in the morning brief

What requires a native build before the icon actually changes on the home screen:
- Adding `expo-dynamic-app-icon` (or equivalent) as a dependency
- Declaring each alternate icon in `app.json` under `ios.config.usesAlternateIcons` + `CFBundleAlternateIcons`, and the Android equivalent under `android.adaptiveIcon` aliases
- Calling the native `setAlternateIconName(...)` API inside `acceptIconChange` in `hooks/useDynamicIcon.ts`

Until then, `acceptIconChange` only persists the user's selection. The selector treats it as a no-op visual confirmation.
