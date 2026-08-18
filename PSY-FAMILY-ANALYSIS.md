# PSY Family — Analysis & Integration Needs

> ניתוח משפחת ה-PSY ב-GitHub והצרכים של psy-sampler להמשך.

---

## מפת המשפחה (16 repos)

### שכבת WHAT (קומפוזיציה)
| Repo | תפקיד | טכנולוגיה |
|---|---|---|
| **psy** | המנוע המקורי | תחילת המשפחה |
| **psy3-clean** | בסיס נקי עם תיקונים קריטיים | UI גרובבוקס |
| **psy4** | PSY LIVE — רדיו-עוקב עם למידה | CandidateGenerator + Grammar |
| **psy4new** | גרסה ניסויית | שקול למזג עם psy4 |
| **psy5** | מנוע ביצועי עם pooled engine | zero GC dropouts |
| **PSY6-ULTIMATE** | מכשיר ביצוע מאוחד | one file, 150+ features, 53 shortcuts |
| **psystar** | פלטפורמת התקן קנונית | 59 פאזות, PWA, P2P, MIDI, נשימה אנושית |

### שכבת HOW (הגשה)
| Repo | תפקיד | טכנולוגיה |
|---|---|---|
| **psy-sampler** (שלנו) | דגימות | 35 features, 301 tests, 15 shortcuts |
| **psydrum** | תופים — analog-modeled | choke groups, kits, groove rendering |
| **psysynth** | סינת' חיטוב | PolyBLEP, Moog LPF, ADSR, no samples |
| **PsySynthPro** | סינת' DSP אמיתי | AudioWorklet, 48kHz, PolyBLEP+wavetable, ZDF SVF, FM |

### שכבת FOUNDATION
| Repo | תפקיד | טכנולוגיה |
|---|---|---|
| **psy-foundation** | תשתית משותפת | 13 packages, 250 tests, transport/protocol/device-sdk/dsp |

---

## מה למדתי מההשוואה

### 1. PSY6 ULTIMATE הוא המתחרה הישיר
PSY6 הוא **מכשיר ביצוע מאוחד** — one file, zero server, 150+ features:
- Brain modes (GENERATIVE/MANUAL/ADAPTIVE)
- Grammar system (למידת bass/melodic/rhythm patterns)
- Factory presets (Psytrance/Techno/Trance/Progressive)
- 53 keyboard shortcuts (לעומת 15 שלנו)
- Master FX chain (filter+delay+reverb+drive)
- **MIDI export/import** (Standard MIDI File)
- Sound design randomizer

### 2. PSYSTAR הוא הכייון השאפתי
- 59 פאזות / 59 פאזות ✅
- PWA installable
- P2P serverless
- "נשימה אנושית" (humanization)
- יומני מסע (journey diaries)
- רשת משפחתית

### 3. PsySynthPro מקצועי יותר ב-DSP
- AudioWorklet (48kHz per-sample)
- PolyBLEP + wavetable
- ZDF State-Variable Filter
- FM synthesis (DX7-style)
- 3D spectrum visualizer
- MIDI export (.mid files)
- PWA

### 4. psy-foundation מכיל את החוזה
- `PsyDevice` interface
- `DeviceHost` + `InMemoryChannel`
- `MusicalEvent` / `NoteEvent` / `MusicalTransport`
- `VoicePool<V>` with free-list
- `Rng` (mulberry32)
- 13 packages: transport, protocol, device-sdk, fixtures, scheduler, analysis, music, material, learning, dsp

---

## צרכים להמשך (מהחסר לעומת המשפחה)

### דחוף — סגירת פערים קריטיים
1. **MIDI export** — PsySynthPro ו-PSY6 כוללים ייצוא .mid. אנחנו לא.
2. **AudioWorklet** — PsySynthPro עובד ב-48kHz per-sample. אנחנו רק AudioBufferSourceNode.
3. **PWA** — PSY6 ו-PSYSTAR installable. אנחנו לא.
4. **Grammar system** — PSY6 לומד patterns. אנחנו רק randomize.

### חשוב — השלמת תכונות
5. **MIDI clock sync** — סנכרון עם DAW חיצוני
6. **Performance pads** — PSY6/PSYSTAR מאפשרים נגינה ידנית
7. **Section jumping** — 1-8 keys ב-PSY6
8. **Chord progression generator** — PSY6 כולל W key

### אסטרטגי — אינטגרציה משפחתית
9. **פרסום foundation כ-npm** — מסיר את ה-shim
10. **חיבור ל-PSY4/PSY6** — השארת ה-host
11. **רשת משפחתית** — PSYSTAR P2P
12. **הסבה ל-PWA** — offline-first

---

## סיכום

המשפחה כוללת **16 repos** עם היררכיה ברורה: WHAT → WHO → HOW. ה-psy-sampler שלנו הוא אחד מ-4 התקני HOW, והוא **חזק בארכיטקטורה אבל חלש ב-DSP** לעומת PsySynthPro.

**הפערים הקריטיים:** MIDI export, AudioWorklet, PWA, grammar learning.
