// app/index.tsx
//
// Écran de diagnostic HealthKit — Test B du runbook de faisabilité.
// Version 3, alignée sur @kingstinct/react-native-healthkit 14.1.0.
//
// Signature confirmée dans les types de la bibliothèque :
//   requestAuthorization(toRequest: AuthDataTypes): Promise<boolean>
//   AuthDataTypes = { toShare?: [...], toRead?: [...] }
//
// Les identifiants sont validés AVANT l'appel d'autorisation : un identifiant
// invalide provoque une exception native que la bibliothèque ne rattrape pas
// proprement, et qui se traduit par une fermeture brutale de l'application.

import * as HK from '@kingstinct/react-native-healthkit';
import { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const BODY_MASS = 'HKQuantityTypeIdentifierBodyMass';
const WORKOUT_TYPE = 'HKWorkoutTypeIdentifier';

// Mettre à false pour ne demander que le poids, si l'identifiant
// d'entraînement ressort invalide à l'étape de validation.
const INCLURE_ENTRAINEMENTS = true;

const mod: any = HK;

// Les fonctions de requête varient encore selon les versions : on les
// résout à l'exécution. L'autorisation, elle, est appelée directement.
function resolve(...names: string[]): { name: string; fn: Function } | null {
  for (const name of names) {
    const fn = mod?.[name] ?? mod?.default?.[name];
    if (typeof fn === 'function') return { name, fn };
  }
  return null;
}

function listExports(): string[] {
  const all = [...Object.keys(mod ?? {}), ...Object.keys(mod?.default ?? {})];
  return Array.from(new Set(all))
    .filter((n) => /quantity|workout|sample|auth|available/i.test(n))
    .sort();
}

type Line = { label: string; value: string; ok: boolean };

export default function TestHealthKit() {
  const [lines, setLines] = useState<Line[]>([]);
  const [running, setRunning] = useState(false);
  const [showExports, setShowExports] = useState(false);

  const push = (label: string, value: string, ok: boolean) =>
    setLines((prev) => [...prev, { label, value, ok }]);

  async function run() {
    setLines([]);
    setShowExports(false);
    setRunning(true);

    try {
      // --- Étape 1 : disponibilité -----------------------------------------
      const avail = resolve('isHealthDataAvailable');
      if (!avail) {
        push('Module', 'isHealthDataAvailable introuvable', false);
        setShowExports(true);
        return;
      }
      const isAvailable = await avail.fn();
      push('HealthKit disponible', String(isAvailable), !!isAvailable);
      if (!isAvailable) return;

      // --- Étape 2 : validation des identifiants ----------------------------
      const toRead = INCLURE_ENTRAINEMENTS
        ? [BODY_MASS, WORKOUT_TYPE]
        : [BODY_MASS];

      const check = resolve(
        'areObjectTypesAvailableAsync',
        'areObjectTypesAvailable',
      );

      if (check) {
        try {
          const res = await check.fn(toRead);
          for (const id of toRead) {
            const ok = !!res?.[id];
            push('identifiant ' + id, ok ? 'valide' : 'REFUSÉ', ok);
          }
        } catch (e: any) {
          push('validation identifiants', e?.message ?? String(e), false);
        }
      } else {
        push('validation identifiants', 'fonction indisponible', false);
      }

      // --- Étape 3 : autorisation -------------------------------------------
      // Point critique du test. Si l'entitlement avait été retiré par
      // SideStore, l'application se fermerait ici même.
      const granted = await HK.requestAuthorization({ toRead });
      push('AUTORISATION', 'retour : ' + String(granted), true);

      // --- Étape 4 : lecture du poids ---------------------------------------
      const recent = resolve(
        'getMostRecentQuantitySample',
        'queryQuantitySamples',
      );

      if (!recent) {
        push('Module', 'aucune fonction de lecture de quantité', false);
        setShowExports(true);
      } else {
        let sample: any = null;

        const tries = [
          () => recent.fn(BODY_MASS, { limit: 1, unit: 'kg' }),
          () => recent.fn(BODY_MASS, 'kg'),
          () => recent.fn(BODY_MASS),
        ];

        for (const t of tries) {
          try {
            const r = await t();
            sample = Array.isArray(r) ? r[0] : (r?.samples?.[0] ?? r);
            if (sample) break;
          } catch (e: any) {
            push('essai lecture poids', e?.message ?? String(e), false);
          }
        }

        if (!sample) {
          push('Dernier poids', 'aucune donnée retournée', false);
        } else {
          const q = sample.quantity ?? sample.value;
          const unit = sample.unit ?? 'kg';
          const date = sample.startDate
            ? new Date(sample.startDate).toLocaleDateString('fr-FR')
            : '?';

          // Doit afficher COROS : preuve que la donnée réelle est lue.
          const src =
            sample.sourceRevision?.source?.name ??
            sample.device?.name ??
            'source inconnue';

          push('DERNIER POIDS', q + ' ' + unit + ' — ' + date, true);
          push('Source de la donnée', src, true);
        }
      }

      // --- Étape 5 : entraînements ------------------------------------------
      if (INCLURE_ENTRAINEMENTS) {
        const from = new Date();
        from.setDate(from.getDate() - 30);

        const wq = resolve('queryWorkoutSamples', 'queryWorkouts');

        if (!wq) {
          push('Entraînements', 'aucune fonction de requête connue', false);
          setShowExports(true);
        } else {
          let workouts: any = null;
          const tries = [
            () => wq.fn({ filter: { startDate: from }, limit: 100 }),
            () => wq.fn({ limit: 100 }),
            () => wq.fn(),
          ];

          for (const t of tries) {
            try {
              workouts = await t();
              break;
            } catch (e: any) {
              push('essai entraînements', e?.message ?? String(e), false);
            }
          }

          const arr = Array.isArray(workouts)
            ? workouts
            : (workouts?.samples ?? []);

          push(
            'Entraînements (via ' + wq.name + ')',
            arr.length + ' trouvé(s)',
            arr.length > 0,
          );
        }
      }

      push('TEST TERMINÉ', 'aucun plantage rencontré', true);
    } catch (e: any) {
      push('ERREUR', e?.message ?? String(e), false);
      setShowExports(true);
    } finally {
      setRunning(false);
    }
  }

  return (
    <ScrollView style={s.page} contentContainerStyle={s.content}>
      <Text style={s.title}>Test B — HealthKit</Text>
      <Text style={s.subtitle}>
        Succès = le poids écrit par COROS s'affiche ci-dessous.
      </Text>

      <TouchableOpacity
        style={[s.button, running && s.buttonOff]}
        onPress={run}
        disabled={running}
      >
        <Text style={s.buttonText}>
          {running ? 'En cours…' : 'Lancer le test'}
        </Text>
      </TouchableOpacity>

      {lines.map((l, i) => (
        <View key={i} style={[s.row, l.ok ? s.rowOk : s.rowKo]}>
          <Text style={s.label}>{l.label}</Text>
          <Text style={s.value}>{l.value}</Text>
        </View>
      ))}

      {showExports && (
        <View style={s.debug}>
          <Text style={s.debugTitle}>Exports pertinents du module</Text>
          <Text style={s.debugText}>{listExports().join('\n')}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#111' },
  content: { padding: 20, paddingTop: 70, paddingBottom: 60 },
  title: { color: '#fff', fontSize: 26, fontWeight: '700' },
  subtitle: { color: '#888', fontSize: 14, marginTop: 6, marginBottom: 24 },
  button: {
    backgroundColor: '#2f6fed',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 24,
  },
  buttonOff: { backgroundColor: '#333' },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  row: {
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderLeftWidth: 4,
    backgroundColor: '#1c1c1e',
  },
  rowOk: { borderLeftColor: '#30c060' },
  rowKo: { borderLeftColor: '#e04040' },
  label: { color: '#8e8e93', fontSize: 12, textTransform: 'uppercase' },
  value: { color: '#fff', fontSize: 16, marginTop: 4 },
  debug: {
    marginTop: 24,
    padding: 14,
    backgroundColor: '#1c1c1e',
    borderRadius: 10,
  },
  debugTitle: {
    color: '#ffb020',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  debugText: { color: '#9a9a9e', fontSize: 12, fontFamily: 'Courier' },
});