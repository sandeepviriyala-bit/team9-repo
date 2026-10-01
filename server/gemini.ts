import { GoogleGenAI } from '@google/genai';
import { RecipeJSON, EngineOutput } from '../src/types';

/**
 * Hybrid AI pass.
 *
 * The deterministic engine (src/engine.ts) already produced `base`. Gemini is
 * only asked to fill the gaps it cannot handle reliably:
 *   - SQL for unsupported / unknown recipe actions (base.validation_report.issues)
 *   - additional, recipe-specific optimization notes
 *   - a short explanation of anything it changed
 *
 * If no credentials are configured, or the call fails, we degrade gracefully and
 * return the deterministic output untouched so the app never hard-fails on AI.
 */

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

function makeClient(): GoogleGenAI | null {
  // Vertex AI (enterprise) path: Workload Identity / service account, no raw key.
  if (process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true') {
    return new GoogleGenAI({
      vertexai: true,
      project: process.env.GOOGLE_CLOUD_PROJECT,
      location: process.env.GOOGLE_CLOUD_LOCATION || 'us-central1',
    });
  }
  // AI Studio key path (simple / dev).
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({ apiKey });
}

interface GeminiPatch {
  enhanced_sql?: string;
  optimization_notes?: string[];
  ai_notes?: string[];
}

function buildPrompt(recipe: RecipeJSON, base: EngineOutput, metadata?: string): string {
  return [
    'You are a BigQuery SQL expert helping a deterministic converter.',
    'A rule-based engine already translated a Salesforce CRM Analytics recipe',
    'into BigQuery SQL, but it flagged some issues it could not handle.',
    '',
    'Your job: return STRICT JSON (no markdown fences) with this shape:',
    '{',
    '  "enhanced_sql": "<full corrected BigQuery SQL, or omit if the base SQL is already correct>",',
    '  "optimization_notes": ["<extra, recipe-specific optimization suggestions>"],',
    '  "ai_notes": ["<short human-readable notes on what you changed and why>"]',
    '}',
    '',
    'Rules:',
    '- Only emit enhanced_sql if you actually fixed an unsupported action or a real bug.',
    '- Preserve the existing CTE structure and table/column mappings already applied.',
    '- Use standard BigQuery SQL (SAFE_CAST, etc.).',
    '- CRITICAL: a column alias (the name after AS) must be a valid BigQuery',
    '  identifier — letters, digits and underscores only, and it must NEVER',
    '  contain a dot. A dot in BigQuery means a struct/field path, so `AS a.b`',
    '  is a syntax error. When you want an alias that reflects a source like',
    '  "pse__Skill" + "Id", write pse__SkillId (drop the dot), and reference it',
    '  the same dotless way everywhere downstream (SELECT, JOIN ON, WHERE).',
    '- Wrap a fully-qualified table name (project.dataset.table) in backticks,',
    '  especially when the project id contains a dash, e.g.',
    '  `datawarehouse-350811.Egen_Certinia_Analysis.Contact`. Only table names',
    '  get backticks; column aliases never do.',
    '',
    '### Recipe JSON',
    JSON.stringify(recipe, null, 2),
    '',
    '### Engine SQL (deterministic)',
    base.final_sql,
    '',
    '### Issues flagged by the engine',
    JSON.stringify(base.validation_report.issues, null, 2),
    '',
    '### BigQuery metadata (optional context)',
    metadata ? metadata.slice(0, 4000) : '(none provided)',
  ].join('\n');
}

/**
 * Safety net: BigQuery column aliases cannot contain a dot (it means a struct
 * path). Gemini sometimes emits `AS pse__Skill.Id`. Find every dotted alias
 * introduced with AS, and replace that exact dotted identifier everywhere in
 * the SQL (definition + downstream references) with a dotless version.
 * Fully-qualified table names (project.dataset.table) are left untouched because
 * they never match a collected alias string.
 */
function sanitizeDottedAliases(sql: string): string {
  const aliasRe = /\bAS\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+)/g;
  const dotted = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = aliasRe.exec(sql)) !== null) dotted.add(m[1]);
  // Replace longest first so overlapping names resolve correctly.
  const ordered = [...dotted].sort((a, b) => b.length - a.length);
  let out = sql;
  for (const d of ordered) {
    out = out.split(d).join(d.replace(/\./g, ''));
  }
  return out;
}

function parsePatch(text: string): GeminiPatch {
  // Gemini may wrap JSON in ```json fences despite instructions.
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try {
    return JSON.parse(cleaned) as GeminiPatch;
  } catch {
    return { ai_notes: ['AI returned unparseable output; kept deterministic SQL.'] };
  }
}

export async function enhanceWithGemini(
  recipe: RecipeJSON,
  base: EngineOutput,
  metadata?: string,
): Promise<EngineOutput> {
  const client = makeClient();
  if (!client) {
    return {
      ...base,
      ai_enhanced: false,
      ai_notes: ['Gemini not configured (set GEMINI_API_KEY or GOOGLE_GENAI_USE_VERTEXAI). Returned deterministic output.'],
    };
  }

  try {
    const response = await client.models.generateContent({
      model: MODEL,
      contents: buildPrompt(recipe, base, metadata),
      // Large recipes produce long SQL; give the model room and keep it deterministic.
      config: { maxOutputTokens: 32768, temperature: 0.1 },
    });
    const patch = parsePatch(response.text ?? '');

    // When Gemini actually rewrote the SQL to resolve the engine's flagged
    // issues, reflect that in the report so the UI shows success, not the
    // engine's original FAIL. Keep the original issues visible in ai_notes.
    const usedEnhanced = Boolean(patch.enhanced_sql?.trim());
    const engineIssues = base.validation_report.issues;
    const resolved = usedEnhanced && engineIssues.length > 0;

    return {
      ...base,
      final_sql: usedEnhanced ? sanitizeDottedAliases(patch.enhanced_sql!.trim()) : base.final_sql,
      validation_report: resolved
        ? { status: 'PASS' as const, issues: [] }
        : base.validation_report,
      optimization_notes: [
        ...base.optimization_notes,
        ...(patch.optimization_notes ?? []),
      ],
      ai_enhanced: true,
      ai_notes: [
        ...(patch.ai_notes ?? []),
        ...(resolved ? [`Resolved by Gemini: ${engineIssues.join('; ')}`] : []),
      ],
    };
  } catch (err: any) {
    return {
      ...base,
      ai_enhanced: false,
      ai_notes: [`Gemini call failed: ${err?.message ?? 'unknown error'}. Returned deterministic output.`],
    };
  }
}
