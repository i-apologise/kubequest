import express from 'express';
import cors from 'cors';
import { missions, getMission, NAMESPACE } from './missions.js';
import {
  ensureNamespace,
  getClusterSnapshot,
  checkWinCondition,
  runAction,
  resetGame,
  clusterHealth,
} from './k8s.js';

const app = express();
const PORT = process.env.PORT || 3847;

app.use(cors());
app.use(express.json());

// In-memory progress (per process — fine for local game)
const progress = {
  completed: [],
  xp: 0,
  currentMission: 1,
};

app.get('/api/health', async (_req, res) => {
  const health = await clusterHealth();
  res.json({ ...health, namespace: NAMESPACE, progress });
});

app.get('/api/missions', (_req, res) => {
  res.json({
    missions: missions.map((m) => ({
      id: m.id,
      code: m.code,
      title: m.title,
      rank: m.rank,
      xp: m.xp,
      icon: m.icon,
      objective: m.objective,
      concepts: m.concepts,
      completed: progress.completed.includes(m.id),
      locked: m.id > 1 && !progress.completed.includes(m.id - 1) && m.id !== progress.currentMission,
    })),
    progress,
  });
});

app.get('/api/missions/:id', (req, res) => {
  const m = getMission(req.params.id);
  if (!m) return res.status(404).json({ error: 'Mission not found' });
  res.json({
    ...m,
    completed: progress.completed.includes(m.id),
  });
});

app.get('/api/cluster', async (_req, res) => {
  try {
    await ensureNamespace();
    const snap = await getClusterSnapshot();
    res.json(snap);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.post('/api/actions/:actionId', async (req, res) => {
  try {
    const result = await runAction(req.params.actionId);
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.body?.message || e.message || String(e) });
  }
});

app.post('/api/missions/:id/check', async (req, res) => {
  const m = getMission(req.params.id);
  if (!m) return res.status(404).json({ error: 'Mission not found' });
  try {
    const result = await checkWinCondition(m.winCondition);
    let leveledUp = false;
    if (result.met && !progress.completed.includes(m.id)) {
      progress.completed.push(m.id);
      progress.xp += m.xp;
      progress.currentMission = Math.min(m.id + 1, missions.length);
      leveledUp = true;
    }
    res.json({ ...result, leveledUp, progress, mission: { id: m.id, xp: m.xp, title: m.title } });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.post('/api/reset', async (_req, res) => {
  try {
    const result = await resetGame();
    progress.completed = [];
    progress.xp = 0;
    progress.currentMission = 1;
    res.json({ ...result, progress });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.listen(PORT, async () => {
  console.log(`\n  ⚔️  KubeQuest API on http://localhost:${PORT}`);
  console.log(`  📦 Namespace: ${NAMESPACE}\n`);
  try {
    const h = await clusterHealth();
    if (h.connected) {
      console.log(`  ✅ Cluster connected (${h.nodes.length} node(s))`);
      await ensureNamespace();
      console.log(`  ✅ Namespace ${NAMESPACE} ready\n`);
    } else {
      console.log(`  ⚠️  No cluster: ${h.error}`);
      console.log(`  Run: npm run setup\n`);
    }
  } catch (e) {
    console.log(`  ⚠️  Cluster check failed: ${e.message}`);
    console.log(`  Run: npm run setup\n`);
  }
});
