import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RecipeToSQLEngine } from './engine';
import { EngineOutput, BigQueryTarget, MappingConfig } from './types';
import { cn } from './lib/utils';
import { Upload, FileJson, FileText, X, Plus, Trash2, Copy, Download, Check, CheckCircle, RefreshCw } from 'lucide-react';

const DEFAULT_RECIPE = {
  "nodes": {
    "Load_Account": {
      "action": "load",
      "parameters": {
        "dataset": {
          "name": "salesforce.account"
        }
      },
      "sources": []
    },
    "Agg_By_Industry": {
      "action": "aggregate",
      "parameters": {
        "groupings": [
          "Industry"
        ],
        "aggregations": [
          {
            "action": "sum",
            "source": "AnnualRevenue",
            "name": "Total_Revenue"
          }
        ]
      },
      "sources": [
        "Load_Account"
      ]
    }
  }
};

interface MetadataInfo {
  tables: string[];
  columns: { table: string; column: string }[];
}

function parseMetadata(content: string, fileName: string): MetadataInfo {
  const info: MetadataInfo = { tables: [], columns: [] };
  const tableSet = new Set<string>();

  if (fileName.endsWith('.json')) {
    try {
      const parsed = JSON.parse(content);
      // Handle array of schema entries: [{ table_name, column_name, ... }]
      if (Array.isArray(parsed)) {
        parsed.forEach((row: any) => {
          const table = row.table_name || row.tableName || row.table || '';
          const col = row.column_name || row.columnName || row.column || row.field_name || row.field || '';
          if (table) {
            tableSet.add(table);
            if (col) info.columns.push({ table, column: col });
          }
        });
      // Handle object keyed by table name: { "table_name": { columns: [...] } }
      } else if (typeof parsed === 'object') {
        Object.entries(parsed).forEach(([key, val]: [string, any]) => {
          if (Array.isArray(val)) {
            tableSet.add(key);
            val.forEach((col: any) => {
              const colName = typeof col === 'string' ? col : col.column_name || col.name || col.field || '';
              if (colName) info.columns.push({ table: key, column: colName });
            });
          } else if (val && typeof val === 'object' && val.columns) {
            tableSet.add(key);
            (val.columns as any[]).forEach((col: any) => {
              const colName = typeof col === 'string' ? col : col.column_name || col.name || col.field || '';
              if (colName) info.columns.push({ table: key, column: colName });
            });
          }
        });
      }
    } catch { /* ignore parse errors */ }
  } else {
    // CSV parsing
    const lines = content.trim().split('\n');
    if (lines.length < 2) return info;
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
    const tableIdx = headers.findIndex(h => ['table_name', 'tablename', 'table'].includes(h));
    const colIdx = headers.findIndex(h => ['column_name', 'columnname', 'column', 'field_name', 'field'].includes(h));

    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(',').map(c => c.trim().replace(/['"]/g, ''));
      const table = tableIdx >= 0 ? cells[tableIdx] : '';
      const col = colIdx >= 0 ? cells[colIdx] : '';
      if (table) {
        tableSet.add(table);
        if (col) info.columns.push({ table, column: col });
      }
    }
  }

  info.tables = Array.from(tableSet);
  return info;
}

function autoMapTables(
  sourceTables: string[],
  targetTables: string[]
): { source: string; target: string }[] {
  return sourceTables.map(src => {
    const srcParts = src.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/);
    let bestMatch = '';
    let bestScore = 0;

    for (const tgt of targetTables) {
      const tgtParts = tgt.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/);
      // Score: count of matching keyword parts
      let score = 0;
      for (const sp of srcParts) {
        for (const tp of tgtParts) {
          if (sp && tp && (sp.includes(tp) || tp.includes(sp))) score++;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = tgt;
      }
    }
    return { source: src, target: bestScore > 0 ? bestMatch : '' };
  });
}

function autoMapColumns(
  sourceColumns: string[],
  metadataColumns: { table: string; column: string }[]
): { source: string; target: string }[] {
  const targetCols = [...new Set(metadataColumns.map(c => c.column))];
  return sourceColumns
    .map(src => {
      const srcLower = src.toLowerCase();
      const exact = targetCols.find(t => t.toLowerCase() === srcLower);
      if (exact) return null; // No mapping needed if names already match
      const partial = targetCols.find(t =>
        t.toLowerCase().includes(srcLower) || srcLower.includes(t.toLowerCase())
      );
      return partial ? { source: src, target: partial } : null;
    })
    .filter((m): m is { source: string; target: string } => m !== null);
}

export default function App() {
  const [jsonInput, setJsonInput] = useState(JSON.stringify(DEFAULT_RECIPE, null, 2));
  const [target, setTarget] = useState<BigQueryTarget>({
    projectId: 'my-project',
    dataset: 'my_dataset',
    targetName: 'my_output_table',
    type: 'table'
  });
  const [output, setOutput] = useState<EngineOutput | null>(null);
  const [activeTab, setActiveTab] = useState<'sql' | 'breakdown' | 'validation' | 'qa' | 'mappings'>('sql');
  const [metadata, setMetadata] = useState<string>('');
  const [metadataFileName, setMetadataFileName] = useState<string>('');
  const [metadataInfo, setMetadataInfo] = useState<MetadataInfo | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mappings, setMappings] = useState<MappingConfig>({
    tables: [],
    columns: []
  });
  const [mappingsConfirmed, setMappingsConfirmed] = useState(false);
  const [pendingMappings, setPendingMappings] = useState<MappingConfig | null>(null);
  const [useAI, setUseAI] = useState(false);
  const [converting, setConverting] = useState(false);

  const recipeFileRef = useRef<HTMLInputElement>(null);
  const metadataFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    handleConvert(true);
    fetchSourceTables();
  }, []);

  const handleConvert = async (includeDDL: boolean) => {
    let parsed: any;
    try {
      parsed = JSON.parse(jsonInput);
    } catch (e: any) {
      console.error(e);
      setOutput({
        final_sql: `-- JSON Parse Error: ${e.message}`,
        cte_breakdown: [],
        field_mapping: [],
        validation_report: { status: 'FAIL', issues: [`Invalid JSON input: ${e.message}`] },
        qa_queries: { row_count_check: '', data_sample_check: '', null_check: '' },
        optimization_notes: []
      });
      setShowModal(false);
      return;
    }

    const effectiveTarget = includeDDL ? target : undefined;

    // AI mode: run the hybrid pass on the Express backend (engine + Gemini).
    if (useAI) {
      setConverting(true);
      try {
        const res = await fetch('/api/convert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipe: parsed, target: effectiveTarget, metadata, mappings, useAI: true })
        });
        if (!res.ok) throw new Error(`Backend responded ${res.status}`);
        const result: EngineOutput = await res.json();
        setOutput(result);
        setShowModal(false);
        return;
      } catch (e: any) {
        console.error(e);
        // Fall back to the deterministic client-side engine if the backend is down.
        const engine = new RecipeToSQLEngine(parsed, effectiveTarget, metadata, mappings);
        const result = engine.generate();
        setOutput({
          ...result,
          ai_enhanced: false,
          ai_notes: [`AI backend unavailable (${e.message}); showing deterministic output.`]
        });
        setShowModal(false);
        return;
      } finally {
        setConverting(false);
      }
    }

    // Deterministic mode: run the engine locally in the browser (no backend needed).
    const engine = new RecipeToSQLEngine(parsed, effectiveTarget, metadata, mappings);
    const result = engine.generate();
    setOutput(result);
    setShowModal(false);
  };

  const handleRecipeUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setJsonInput(content);
      fetchSourceTables(content); // Auto-fetch immediately on upload
    };
    reader.readAsText(file);
  };

  const handleMetadataUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMetadataFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setMetadata(content);

      const info = parseMetadata(content, file.name);
      setMetadataInfo(info);

      if (info.tables.length > 0) {
        // Extract source tables from current recipe
        const sourceTables = getSourceTables(jsonInput);
        const sourceColumns = getSourceColumns(jsonInput);

        const autoTables = autoMapTables(sourceTables, info.tables);
        const autoCols = autoMapColumns(sourceColumns, info.columns);

        const pending: MappingConfig = { tables: autoTables, columns: autoCols };
        setPendingMappings(pending);
        setMappingsConfirmed(false);
      }
    };
    reader.readAsText(file);
  };

  const getSourceTables = (input?: string): string[] => {
    try {
      const parsed = JSON.parse(input || jsonInput);
      const tables: string[] = [];
      Object.values(parsed.nodes || {}).forEach((node: any) => {
        if (node.action === 'load') {
          const name = node.parameters?.dataset?.name || node.parameters?.dataset?.label;
          if (name) tables.push(name);
        }
      });
      return tables;
    } catch { return []; }
  };

  const getSourceColumns = (input?: string): string[] => {
    try {
      const parsed = JSON.parse(input || jsonInput);
      const cols = new Set<string>();
      Object.values(parsed.nodes || {}).forEach((node: any) => {
        if (node.action === 'aggregate') {
          (node.parameters?.groupings || []).forEach((g: string) => cols.add(g));
          (node.parameters?.aggregations || []).forEach((a: any) => { if (a.source) cols.add(a.source); });
        }
        if (node.action === 'filter') {
          (node.parameters?.filterExpressions || []).forEach((f: any) => { if (f.field) cols.add(f.field); });
        }
        if (node.action === 'join') {
          (node.parameters?.leftKeys || []).forEach((k: string) => cols.add(k));
          (node.parameters?.rightKeys || []).forEach((k: string) => cols.add(k));
        }
        if (node.action === 'computeExpression') {
          (node.parameters?.expressions || []).forEach((e: any) => { if (e.name) cols.add(e.name); });
        }
      });
      return Array.from(cols);
    } catch { return []; }
  };

  const confirmMappings = () => {
    if (pendingMappings) {
      setMappings(pendingMappings);
      setPendingMappings(null);
      setMappingsConfirmed(true);
    }
  };

  const rejectMappings = () => {
    setPendingMappings(null);
    setMappingsConfirmed(false);
  };

  const regenerateMappings = () => {
    if (!metadataInfo) return;
    const sourceTables = getSourceTables();
    const sourceColumns = getSourceColumns();
    const autoTables = autoMapTables(sourceTables, metadataInfo.tables);
    const autoCols = autoMapColumns(sourceColumns, metadataInfo.columns);
    setPendingMappings({ tables: autoTables, columns: autoCols });
    setMappingsConfirmed(false);
  };

  const addMapping = (type: 'tables' | 'columns') => {
    setMappings({
      ...mappings,
      [type]: [...mappings[type], { source: '', target: '' }]
    });
  };

  const updateMapping = (type: 'tables' | 'columns', index: number, field: 'source' | 'target', value: string) => {
    const newMappings = { ...mappings };
    newMappings[type][index][field] = value;
    setMappings(newMappings);
  };

  const removeMapping = (type: 'tables' | 'columns', index: number) => {
    const newMappings = { ...mappings };
    newMappings[type] = newMappings[type].filter((_, i) => i !== index);
    setMappings(newMappings);
  };

  const fetchSourceTables = (inputOverride?: string) => {
    try {
      const jsonToParse = inputOverride || jsonInput;
      const parsed = JSON.parse(jsonToParse);
      const sourceTables = new Set<string>();
      
      Object.values(parsed.nodes || {}).forEach((node: any) => {
        if (node.action === 'load') {
          const name = node.parameters?.dataset?.name || node.parameters?.dataset?.label;
          if (name) {
            sourceTables.add(name);
          }
        }
      });

      setMappings(prev => {
        const newTableMappings = [...prev.tables];
        sourceTables.forEach(source => {
          if (!newTableMappings.some(m => m.source.toLowerCase() === source.toLowerCase())) {
            newTableMappings.push({ source, target: '' });
          }
        });
        return { ...prev, tables: newTableMappings };
      });
    } catch (e) {
      console.error("Failed to parse JSON for source fetching", e);
    }
  };

  const handleCopy = () => {
    if (!output) return;
    navigator.clipboard.writeText(output.final_sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExport = () => {
    if (!output) return;
    const blob = new Blob([output.final_sql], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `egen_transformation_${target.targetName || 'output'}.sql`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen flex flex-col bg-white font-sans text-gray-1000">
      {/* Navigation / Header */}
      <header className="h-16 bg-blue-900 flex items-center px-8 shrink-0">
        <h1 className="text-white text-lg m-0 lowercase">
          <span className="font-medium">egen</span> transformation engine
        </h1>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {/* Sidebar - Input Area */}
        <aside className="w-1/3 bg-gray-60 border-r border-gray-200 flex flex-col p-8 gap-8 overflow-y-auto">
          <section>
            <div className="flex justify-between items-center mb-4">
              <h2 className="egen-heading mt-0 mb-0">recipe input</h2>
              <button 
                onClick={() => recipeFileRef.current?.click()}
                className="text-xs text-blue-900 flex items-center gap-1 hover:underline cursor-pointer"
              >
                <Upload size={12} /> upload json
              </button>
              <input 
                type="file" 
                ref={recipeFileRef} 
                className="hidden" 
                accept=".json" 
                onChange={handleRecipeUpload} 
              />
            </div>
            <p className="egen-subtle mb-4">paste your salesforce recipe json or upload a file</p>
            <textarea
              className="w-full h-[30vh] bg-white rounded-lg p-4 font-mono text-sm border-none focus:ring-2 focus:ring-blue-900 outline-none resize-none"
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              spellCheck={false}
            />
          </section>

          {/* Metadata Context - moved before mappings */}
          <section>
            <div className="flex justify-between items-center mb-4">
              <h2 className="egen-heading mt-0 mb-0">metadata context</h2>
              {!metadata ? (
                <button
                  onClick={() => metadataFileRef.current?.click()}
                  className="text-xs text-blue-900 flex items-center gap-1 hover:underline cursor-pointer"
                >
                  <Upload size={12} /> upload csv
                </button>
              ) : (
                <button
                  onClick={() => { setMetadata(''); setMetadataFileName(''); setMetadataInfo(null); setPendingMappings(null); }}
                  className="text-xs text-red-600 flex items-center gap-1 hover:underline cursor-pointer"
                >
                  <X size={12} /> remove
                </button>
              )}
              <input
                type="file"
                ref={metadataFileRef}
                className="hidden"
                accept=".csv,.json"
                onChange={handleMetadataUpload}
              />
            </div>
            <p className="egen-subtle mb-4">optional: upload bigquery schema or metadata for auto-mapping</p>
            {metadata ? (
              <div className="space-y-3">
                <div className="egen-card-primary p-4 flex items-center gap-3 border border-blue-50">
                  <FileText className="text-blue-900" size={20} />
                  <div className="flex-1 overflow-hidden">
                    <p className="text-sm font-medium truncate">{metadataFileName}</p>
                    <p className="text-xs text-gray-200">
                      {(metadata.length / 1024).toFixed(1)} kb
                      {metadataInfo && ` · ${metadataInfo.tables.length} tables · ${metadataInfo.columns.length} columns detected`}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div
                onClick={() => metadataFileRef.current?.click()}
                className="egen-card-primary p-8 border-2 border-dashed border-gray-200 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-blue-900 transition-colors"
              >
                <Upload className="text-gray-200" size={24} />
                <p className="text-xs text-gray-200">click to upload schema csv or json</p>
              </div>
            )}
          </section>

          {/* Pending Mapping Review */}
          <AnimatePresence>
            {pendingMappings && (
              <motion.section
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-4 overflow-hidden"
              >
                <div className="p-5 bg-blue-50 rounded-xl border border-blue-900/20 space-y-4">
                  <div className="flex justify-between items-center">
                    <h2 className="text-sm font-medium text-blue-900">review auto-mapped results</h2>
                    <button
                      onClick={regenerateMappings}
                      className="text-xs text-blue-900 flex items-center gap-1 hover:underline cursor-pointer"
                    >
                      <RefreshCw size={12} /> re-map
                    </button>
                  </div>
                  <p className="egen-subtle text-xs">mappings were generated from your metadata. edit if needed, then confirm or dismiss.</p>

                  {/* Pending Table Mappings */}
                  {pendingMappings.tables.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-xs font-medium text-blue-900 uppercase tracking-wider">table mappings</h3>
                      {pendingMappings.tables.map((m, i) => (
                        <div key={i} className="flex gap-2 items-center">
                          <input
                            type="text"
                            className="flex-1 bg-white rounded-md p-2 text-xs outline-none focus:ring-1 focus:ring-blue-900"
                            value={m.source}
                            onChange={(e) => {
                              const updated = { ...pendingMappings };
                              updated.tables = [...updated.tables];
                              updated.tables[i] = { ...updated.tables[i], source: e.target.value };
                              setPendingMappings(updated);
                            }}
                          />
                          <span className="text-gray-200 text-xs">→</span>
                          <input
                            type="text"
                            className={cn(
                              "flex-1 bg-white rounded-md p-2 text-xs outline-none focus:ring-1 focus:ring-blue-900",
                              m.target ? "" : "border border-amber-400"
                            )}
                            placeholder={m.target ? undefined : "no match found"}
                            value={m.target}
                            onChange={(e) => {
                              const updated = { ...pendingMappings };
                              updated.tables = [...updated.tables];
                              updated.tables[i] = { ...updated.tables[i], target: e.target.value };
                              setPendingMappings(updated);
                            }}
                          />
                          <button
                            onClick={() => {
                              const updated = { ...pendingMappings };
                              updated.tables = updated.tables.filter((_, idx) => idx !== i);
                              setPendingMappings(updated);
                            }}
                            className="text-gray-200 hover:text-red-600"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Pending Column Mappings */}
                  {pendingMappings.columns.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-xs font-medium text-blue-900 uppercase tracking-wider">column mappings</h3>
                      {pendingMappings.columns.map((m, i) => (
                        <div key={i} className="flex gap-2 items-center">
                          <input
                            type="text"
                            className="flex-1 bg-white rounded-md p-2 text-xs outline-none focus:ring-1 focus:ring-blue-900"
                            value={m.source}
                            onChange={(e) => {
                              const updated = { ...pendingMappings };
                              updated.columns = [...updated.columns];
                              updated.columns[i] = { ...updated.columns[i], source: e.target.value };
                              setPendingMappings(updated);
                            }}
                          />
                          <span className="text-gray-200 text-xs">→</span>
                          <input
                            type="text"
                            className="flex-1 bg-white rounded-md p-2 text-xs outline-none focus:ring-1 focus:ring-blue-900"
                            value={m.target}
                            onChange={(e) => {
                              const updated = { ...pendingMappings };
                              updated.columns = [...updated.columns];
                              updated.columns[i] = { ...updated.columns[i], target: e.target.value };
                              setPendingMappings(updated);
                            }}
                          />
                          <button
                            onClick={() => {
                              const updated = { ...pendingMappings };
                              updated.columns = updated.columns.filter((_, idx) => idx !== i);
                              setPendingMappings(updated);
                            }}
                            className="text-gray-200 hover:text-red-600"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {pendingMappings.tables.length === 0 && pendingMappings.columns.length === 0 && (
                    <p className="egen-subtle text-xs text-center py-2">no mappings could be generated — add them manually below</p>
                  )}

                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={confirmMappings}
                      className="flex-1 py-2.5 bg-blue-900 text-white text-xs rounded-lg hover:bg-opacity-90 transition-all cursor-pointer flex items-center justify-center gap-2"
                    >
                      <CheckCircle size={14} /> confirm mappings
                    </button>
                    <button
                      onClick={rejectMappings}
                      className="flex-1 py-2.5 bg-white text-gray-200 text-xs rounded-lg hover:text-gray-1000 transition-all cursor-pointer border border-gray-200"
                    >
                      dismiss
                    </button>
                  </div>
                </div>
              </motion.section>
            )}
          </AnimatePresence>

          {/* Confirmed Mappings / Manual Mappings */}
          <section className="space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <h2 className="egen-heading mt-0 mb-0">mappings</h2>
                {mappingsConfirmed && (
                  <span className="text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <CheckCircle size={10} /> confirmed
                  </span>
                )}
              </div>
              {metadataInfo && (
                <button
                  onClick={regenerateMappings}
                  className="text-xs text-blue-900 flex items-center gap-1 hover:underline cursor-pointer"
                >
                  <RefreshCw size={12} /> re-map from metadata
                </button>
              )}
            </div>
            <p className="egen-subtle">map source tables and columns to bigquery targets</p>

            <div className="space-y-6">
              {/* Table Mappings */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-medium text-blue-900 uppercase tracking-wider">table mappings</h3>
                  <div className="flex gap-3">
                    <button
                      onClick={fetchSourceTables}
                      className="text-xs text-blue-900 flex items-center gap-1 hover:underline cursor-pointer"
                    >
                      auto-fetch
                    </button>
                    <button
                      onClick={() => addMapping('tables')}
                      className="text-xs text-blue-900 flex items-center gap-1 hover:underline cursor-pointer"
                    >
                      <Plus size={12} /> add
                    </button>
                  </div>
                </div>
                {mappings.tables.map((m, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input
                      type="text"
                      placeholder="source table"
                      className="flex-1 bg-white rounded-md p-2 text-xs outline-none focus:ring-1 focus:ring-blue-900"
                      value={m.source}
                      onChange={(e) => updateMapping('tables', i, 'source', e.target.value)}
                    />
                    <span className="text-gray-200 text-xs">→</span>
                    <input
                      type="text"
                      placeholder="target table"
                      className="flex-1 bg-white rounded-md p-2 text-xs outline-none focus:ring-1 focus:ring-blue-900"
                      value={m.target}
                      onChange={(e) => updateMapping('tables', i, 'target', e.target.value)}
                    />
                    <button onClick={() => removeMapping('tables', i)} className="text-gray-200 hover:text-red-600">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>

              {/* Column Mappings */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-medium text-blue-900 uppercase tracking-wider">column mappings</h3>
                  <button
                    onClick={() => addMapping('columns')}
                    className="text-xs text-blue-900 flex items-center gap-1 hover:underline cursor-pointer"
                  >
                    <Plus size={12} /> add
                  </button>
                </div>
                {mappings.columns.map((m, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input
                      type="text"
                      placeholder="source col"
                      className="flex-1 bg-white rounded-md p-2 text-xs outline-none focus:ring-1 focus:ring-blue-900"
                      value={m.source}
                      onChange={(e) => updateMapping('columns', i, 'source', e.target.value)}
                    />
                    <span className="text-gray-200 text-xs">→</span>
                    <input
                      type="text"
                      placeholder="target col"
                      className="flex-1 bg-white rounded-md p-2 text-xs outline-none focus:ring-1 focus:ring-blue-900"
                      value={m.target}
                      onChange={(e) => updateMapping('columns', i, 'target', e.target.value)}
                    />
                    <button onClick={() => removeMapping('columns', i)} className="text-gray-200 hover:text-red-600">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="egen-heading mt-0">bigquery target</h2>
            <div className="space-y-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-200">project id</label>
                <input
                  type="text"
                  className="w-full bg-white rounded-md p-2 text-sm outline-none focus:ring-1 focus:ring-blue-900"
                  value={target.projectId}
                  onChange={(e) => setTarget({ ...target, projectId: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-200">dataset</label>
                <input
                  type="text"
                  className="w-full bg-white rounded-md p-2 text-sm outline-none focus:ring-1 focus:ring-blue-900"
                  value={target.dataset}
                  onChange={(e) => setTarget({ ...target, dataset: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-200">table / view name</label>
                <input
                  type="text"
                  className="w-full bg-white rounded-md p-2 text-sm outline-none focus:ring-1 focus:ring-blue-900"
                  value={target.targetName}
                  onChange={(e) => setTarget({ ...target, targetName: e.target.value })}
                />
              </div>
              <div className="flex gap-4 pt-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="targetType"
                    checked={target.type === 'table'}
                    onChange={() => setTarget({ ...target, type: 'table' })}
                  />
                  table
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="targetType"
                    checked={target.type === 'view'}
                    onChange={() => setTarget({ ...target, type: 'view' })}
                  />
                  view
                </label>
              </div>
            </div>
          </section>
          
          <label className="flex items-center gap-3 mb-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={useAI}
              onChange={(e) => setUseAI(e.target.checked)}
              className="h-4 w-4 accent-blue-900 cursor-pointer"
            />
            <span className="text-sm text-blue-900">
              enhance with gemini ai (hybrid)
              <span className="block text-xs text-gray-400">
                runs the engine, then asks gemini to fix unsupported nodes & add optimizations
              </span>
            </span>
          </label>

          <button
            onClick={() => setShowModal(true)}
            disabled={converting}
            className="w-full py-4 bg-blue-900 text-white rounded-lg hover:bg-opacity-90 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {converting ? 'converting…' : 'convert to bigquery sql'}
          </button>
        </aside>

        {/* Modal Overlay */}
        <AnimatePresence>
          {showModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowModal(false)}
                className="absolute inset-0 bg-blue-900/20 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-md bg-white rounded-2xl p-8 shadow-xl"
              >
                <h2 className="egen-heading mt-0">sql generation options</h2>
                <p className="egen-subtle mb-8">would you like to include the create or replace table statement in the output?</p>
                
                <div className="space-y-3">
                  <button 
                    onClick={() => handleConvert(true)}
                    className="w-full py-4 bg-blue-900 text-white rounded-lg hover:bg-opacity-90 transition-all cursor-pointer text-sm"
                  >
                    include create or replace
                  </button>
                  <button 
                    onClick={() => handleConvert(false)}
                    className="w-full py-4 bg-blue-50 text-blue-900 rounded-lg hover:bg-blue-100 transition-all cursor-pointer text-sm"
                  >
                    just select statement
                  </button>
                  <button 
                    onClick={() => setShowModal(false)}
                    className="w-full py-4 text-gray-200 hover:text-gray-1000 transition-all cursor-pointer text-sm"
                  >
                    cancel
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Main Content - Output Area */}
        <section className="flex-1 bg-white p-12 overflow-y-auto">
          <div className="max-w-4xl">
            <h2 className="egen-heading mt-0">transformation output</h2>
            <p className="egen-subtle mb-8">optimized bigquery sql generated from your recipe logic</p>

            {output?.validation_report.status === 'FAIL' && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mb-8 p-6 bg-red-50 border border-red-100 rounded-xl flex items-start gap-4"
              >
                <div className="p-2 bg-red-100 rounded-lg text-red-600">
                  <X size={20} />
                </div>
                <div>
                  <h3 className="text-red-900 font-medium text-sm mb-1">SQL Generation Failed</h3>
                  <p className="text-red-700 text-sm">{output.validation_report.issues[0]}</p>
                  <button 
                    onClick={() => setActiveTab('validation')}
                    className="mt-2 text-xs font-medium text-red-900 hover:underline"
                  >
                    view all issues
                  </button>
                </div>
              </motion.div>
            )}

            {/* Tabs */}
            <div className="flex gap-8 mb-8 border-b border-gray-100">
              {(['sql', 'breakdown', 'mappings', 'validation', 'qa'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    "pb-4 text-sm transition-all cursor-pointer",
                    activeTab === tab 
                      ? "text-blue-900 border-b-2 border-blue-900" 
                      : "text-gray-200 hover:text-gray-1000"
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>

            <AnimatePresence mode="wait">
              {output && (
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  {activeTab === 'sql' && (
                    <div className="relative group">
                      <div className="absolute right-4 top-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={handleCopy}
                          className="p-2 bg-white rounded-md shadow-sm text-blue-900 hover:bg-blue-50 transition-colors cursor-pointer flex items-center gap-2 text-xs"
                          title="Copy to clipboard"
                        >
                          {copied ? <Check size={14} /> : <Copy size={14} />}
                          {copied ? 'copied' : 'copy'}
                        </button>
                        <button 
                          onClick={handleExport}
                          className="p-2 bg-white rounded-md shadow-sm text-blue-900 hover:bg-blue-50 transition-colors cursor-pointer flex items-center gap-2 text-xs"
                          title="Export as .sql"
                        >
                          <Download size={14} />
                          export
                        </button>
                      </div>
                      <div className="egen-card-secondary p-8 font-mono text-sm whitespace-pre overflow-x-auto text-gray-1000">
                        {output.final_sql}
                      </div>
                    </div>
                  )}

                  {activeTab === 'breakdown' && (
                    <div className="space-y-4">
                      {output.cte_breakdown.map((step, i) => (
                        <div key={i} className="egen-card-secondary p-6">
                          <h3 className="text-blue-900 text-sm mb-1">{step.step}</h3>
                          <p className="egen-body text-sm">{step.description}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {activeTab === 'mappings' && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-3 gap-4 font-medium text-xs text-blue-900 uppercase tracking-wider mb-2 px-4">
                        <div>source field</div>
                        <div>transformation</div>
                        <div>final field</div>
                      </div>
                      {output.field_mapping.map((m, i) => (
                        <div key={i} className="egen-card-secondary p-4 grid grid-cols-3 gap-4 text-sm items-center">
                          <div className="font-mono text-xs truncate">{m.source_field}</div>
                          <div className="text-gray-200">{m.transformation}</div>
                          <div className="font-mono text-xs text-blue-900">{m.final_field}</div>
                        </div>
                      ))}
                      {output.field_mapping.length === 0 && (
                        <p className="egen-subtle text-center py-8">no field transformations detected</p>
                      )}
                    </div>
                  )}

                  {activeTab === 'validation' && (
                    <div className="space-y-6">
                      <div className={cn(
                        "p-6 rounded-lg",
                        output.validation_report.status === 'PASS' ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"
                      )}>
                        status: {output.validation_report.status}
                      </div>
                      {output.validation_report.issues.length > 0 && (
                        <div className="space-y-2">
                          <h3 className="text-sm">detected issues</h3>
                          {output.validation_report.issues.map((issue, i) => (
                            <div key={i} className="egen-card-secondary p-4 text-sm">
                              {issue}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {activeTab === 'qa' && (
                    <div className="space-y-6">
                      {Object.entries(output.qa_queries).map(([key, query]) => (
                        <div key={key} className="space-y-2">
                          <h3 className="text-sm">{key.replace(/_/g, ' ')}</h3>
                          <div className="egen-card-secondary p-4 font-mono text-xs">
                            {query as string}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Gemini AI Notes */}
            {output && output.ai_notes && output.ai_notes.length > 0 && (
              <div className="mt-12 pt-12 border-t border-gray-100">
                <h2 className="egen-heading">
                  gemini ai {output.ai_enhanced ? '✓ enhanced' : '(not applied)'}
                </h2>
                <div className="grid grid-cols-1 gap-4 mt-4">
                  {output.ai_notes.map((note, i) => (
                    <div key={i} className="egen-card-secondary p-4 text-sm">
                      {note}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Optimization Notes */}
            {output && output.optimization_notes.length > 0 && (
              <div className="mt-12 pt-12 border-t border-gray-100">
                <h2 className="egen-heading">optimization notes</h2>
                <div className="grid grid-cols-1 gap-4 mt-4">
                  {output.optimization_notes.map((note, i) => (
                    <div key={i} className="egen-card-secondary p-4 text-sm">
                      {note}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
