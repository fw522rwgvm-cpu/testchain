// app/index.tsx
//
// Écran de diagnostic HealthKit — Test B du runbook de faisabilité.
// Objectif unique : prouver que l'entitlement HealthKit survit à la signature
// SideStore et que la lecture des données fonctionne réellement.
//
// Ce code est jetable. Il privilégie le diagnostic sur l'élégance :
// - aucun chargement automatique au montage (cause n°1 de plantage)
// - toutes les erreurs affichées à l'écran, jamais en console
// - résolution des fonctions à l'exécution, l'API ayant changé entre versions

import * as HK from '@kingstinct/react-native-healthkit';
import { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

// --- Identifiants HealthKit, en chaînes brutes ---------------------------
// La version actuelle de la bibliothèque accepte les chaînes directement.
// Les anciennes versions exposaient des énumérations dont la valeur
// est justement cette même chaîne : le code fonctionne dans les deux cas.

const BODY_MASS = 'HKQuantityTypeIdentifierBodyMass';
const WORKOUT_TYPE = 'HKWorkoutTypeIdentifier';

// --- Résolution d'API ----------------------------------------------------
// Selon la version installée, les fonctions sont soit des exports nommés,
// soit des méthodes d'un objet exporté par défaut, et certains noms ont
// changé. On cherche parmi les variantes connues.

const mod: any = HK;

function resolve(...names: string[]): { name: string; fn: Function } | null {
  for (const name of names) {
    const fn = mod?.[name] ?? mod?.default?.[name];
    if (typeof fn === 'function') return { name, fn };
  }
  return null;
}

function listExports(): string[] {
  const direct = Object.keys(mod ?? {});
  const nested = Object.keys(mod?.default ?? {});
  return Array.from(new Set([...direct, ...nested])).sort();
}

// --- Écran ---------------------------------------------------------------

type Line = { label: string; value: string; ok: boolean };

export default function TestHealthKit() {
  const [lines, setLines] = useState<Line[]>([]);
  const [running, setRunning] = useState(false);
  const [showExports, setShowExports] = useState(false);

  const push = (label: string, value: string, ok: boolean) =>
    setLines((prev) => [...prev, { label, value, ok }]);

  async function run() {
    setLines([]);
    setRunning(true);

    try {
      // --- Étape 1 : disponibilité de HealthKit ---------------------------
      const avail = resolve('isHealthDataAvailable');
      if (!avail) {
        push('Module', 'isHealthDataAvailable introuvable', false);
        setShowExports(true);
        return;
      }

      const isAvailable = await avail.fn();
      push('HealthKit disponible', String(isAvailable), !!isAvailable);
      if (!isAvailable) return;

      // --- Étape 2 : autorisation de lecture -------------------------------
      // C'est ICI que se joue le test. Si l'entitlement a été retiré par
      // SideStore, l'application se ferme brutalement à cet appel.
      const auth = resolve('requestAuthorization');
      if (!auth) {
        push('Module', 'requestAuthorization introuvable', false);
        setShowExports(true);
        return;
      }

      const toRead = [BODY_MASS, WORKOUT_TYPE];

      try {
        // Signature récente : un objet
        await auth.fn({ toRead });
      } catch {
        // Signature ancienne : deux tableaux (lecture, écriture)
        await auth.fn(toRead, []);
      }

      push('Autorisation demandée', 'feuille affichée sans plantage', true);

      // --- Étape 3 : lecture du poids --------------------------------------
      const recent = resolve('getMostRecentQuantitySample');
      if (!recent) {
        push('Module', 'getMostRecentQuantitySample introuvable', false);
        setShowExports(true);
      } else {
        const sample = await recent.fn(BODY_MASS, 'kg');

        if (!sample) {
          push(
            'Dernier poids',
            'aucune donnée — autorisation refusée, ou app Santé vide',
            false,
          );
        } else {
          const q = sample.quantity ?? sample.value;
          const unit = sample.unit ?? 'kg';
          const date = sample.startDate
            ? new Date(sample.startDate).toLocaleDateString('fr-FR')
            : '?';

          // Le nom de la source doit afficher COROS : c'est la preuve
          // que la donnée réelle est bien lue, et non un artefact.
          const src =
            sample.sourceRevision?.source?.name ??
            sample.device?.name ??
            'source inconnue';

          push('Dernier poids', `${q} ${unit} — ${date}`, true);
          push('Source de la donnée', src, true);
        }
      }

      // --- Étape 4 : entraînements sur 30 jours -----------------------------
      const from = new Date();
      from.setDate(from.getDate() - 30);

      const wq = resolve(
        'queryWorkoutSamples',
        'queryWorkouts',
        'getWorkouts',
        'queryWorkoutSamplesWithAnchor',
      );

      if (!wq) {
        push('Entraînements', 'aucune fonction de requête connue', false);
        setShowExports(true);
      } else {
        let workouts: any = null;

        try {
          workouts = await wq.fn({ filter: { startDate: from }, limit: 100 });
        } catch {
          try {
            workouts = await wq.fn({ from });
          } catch {
            workouts = await wq.fn();
          }
        }

        const arr = Array.isArray(workouts)
          ? workouts
          : (workouts?.samples ?? []);

        push(
          `Entraînements (30 j, via ${wq.name})`,
          `${arr.length} trouvé(s)`,
          true,
        );

        if (arr.length > 0) {
          const w = arr[0];
          const type = w.workoutActivityType ?? w.activityType ?? '?';
          const d = w.startDate
            ? new Date(w.startDate).toLocaleDateString('fr-FR')
            : '?';
          push('Dernier entraînement', `type ${type} — ${d}`, true);
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
          <Text style={s.debugTitle}>Exports disponibles du module</Text>
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
  debug: { marginTop: 24, padding: 14, backgroundColor: '#1c1c1e', borderRadius: 10 },
  debugTitle: { color: '#ffb020', fontSize: 13, fontWeight: '600', marginBottom: 8 },
  debugText: { color: '#9a9a9e', fontSize: 12, fontFamily: 'Courier' },
});
