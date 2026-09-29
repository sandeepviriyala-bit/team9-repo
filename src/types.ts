export interface RecipeNode {
  action: string;
  parameters: any;
  sources: string[];
}

export interface RecipeJSON {
  nodes: { [key: string]: RecipeNode };
}

export interface SQLStep {
  step: string;
  description: string;
}

export interface FieldMapping {
  source_field: string;
  transformation: string;
  final_field: string;
}

export interface ValidationReport {
  status: 'PASS' | 'FAIL';
  issues: string[];
}

export interface QAQueries {
  row_count_check: string;
  data_sample_check: string;
  null_check: string;
}

export interface BigQueryTarget {
  projectId: string;
  dataset: string;
  targetName: string;
  type: 'table' | 'view';
}

export interface MappingConfig {
  tables: { source: string; target: string }[];
  columns: { source: string; target: string }[];
}

export interface EngineOutput {
  final_sql: string;
  cte_breakdown: SQLStep[];
  field_mapping: FieldMapping[];
  validation_report: ValidationReport;
  qa_queries: QAQueries;
  optimization_notes: string[];
  metadata_summary?: string;
}
