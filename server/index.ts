import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { RecipeToSQLEngine } from '../src/engine';
import { RecipeJSON, BigQueryTarget, MappingConfig } from '../src/types';
import { enhanceWithGemini } from './gemini';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '5mb' }));

const PORT = Number(process.env.PORT) || 8080;

interface ConvertBody {
  recipe: RecipeJSON;
  target?: BigQueryTarget;
  metadata?: string;
  mappings?: MappingConfig;
  useAI?: boolean;
}

/**
 * Hybrid convert endpoint.
 * 1. Runs the deterministic engine (always).
 * 2. If useAI is set, runs the Gemini pass to fill gaps.
 */
app.post('/api/convert', async (req, res) => {
  const { recipe, target, metadata, mappings, useAI } = req.body as ConvertBody;

  if (!recipe || !recipe.nodes) {
    return res.status(400).json({ error: 'Body must include a recipe with a "nodes" object.' });
  }

  try {
    const engine = new RecipeToSQLEngine(recipe, target, metadata, mappings);
    const base = engine.generate();

    if (!useAI) {
      return res.json({ ...base, ai_enhanced: false });
    }

    const enhanced = await enhanceWithGemini(recipe, base, metadata);
    return res.json(enhanced);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'conversion failed' });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    ai_configured:
      process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true' ||
      Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'),
  });
});

// Serve the built frontend (dist/) in production. In dev, Vite serves the UI
// and proxies /api here, so this static block is simply inert.
const distPath = path.resolve(__dirname, '../dist');
app.use(express.static(distPath));
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Recipe-to-SQL server listening on :${PORT}`);
});
