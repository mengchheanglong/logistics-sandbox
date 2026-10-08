import React from 'react';
import { Play, Table, Code2, Clock, Sparkles } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Card } from '../../components/ui/card';

interface CypherStudioTabProps {
  customCypher: string;
  onChangeCypher: (query: string) => void;
  onExecuteCypher: (query?: string) => void;
  runningCypher: boolean;
  queryExecutionTimeMs: number | null;
  cypherOutput: { columns: string[]; rows: any[][] } | null;
  rawJsonOutput: any;
  queryViewMode: 'table' | 'json';
  onToggleViewMode: (mode: 'table' | 'json') => void;
}

export function CypherStudioTab({
  customCypher,
  onChangeCypher,
  onExecuteCypher,
  runningCypher,
  queryExecutionTimeMs,
  cypherOutput,
  rawJsonOutput,
  queryViewMode,
  onToggleViewMode,
}: CypherStudioTabProps) {
  const presets = [
    {
      label: '📊 Fleet by Depot',
      query:
        'MATCH (d:Depot)-[:DISPATCHES]->(v:Vehicle) RETURN d.name AS Depot, v.type AS VehicleType, count(v) AS FleetCount',
    },
    {
      label: '👥 Customer Referral Graph',
      query:
        'MATCH (c:Customer) RETURN c.id AS CustomerID, c.name AS FullName, c.city AS City, c.tier AS Tier LIMIT 10',
    },
    {
      label: '🚚 Vehicle to Driver Pairings',
      query:
        'MATCH (v:Vehicle)-[:ASSIGNED_TO]->(drv:Driver) RETURN v.id AS Vehicle, v.type AS Type, drv.name AS DriverName, drv.status AS DriverStatus',
    },
    {
      label: '🏬 Warehouse Feeds Depots',
      query:
        'MATCH (w:Warehouse)-[:FEEDS]->(d:Depot) RETURN w.name AS CentralHub, d.name AS RegionalDepot',
    },
  ];

  return (
    <div className="space-y-4 animate-in fade-in duration-150">
      {/* Quick Presets Row */}
      <div className="space-y-2">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-purple-400" />
          <span>Preset Query Library</span>
        </span>
        <div className="flex flex-wrap gap-2">
          {presets.map((preset, idx) => (
            <button
              key={idx}
              onClick={() => {
                onChangeCypher(preset.query);
                onExecuteCypher(preset.query);
              }}
              className="px-3 py-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-800 hover:border-purple-500/50 text-slate-300 text-xs font-mono transition-all cursor-pointer flex items-center space-x-1.5 active:scale-95"
            >
              <span>{preset.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Cypher Input Bar */}
      <div className="flex gap-2">
        <input
          type="text"
          value={customCypher}
          onChange={(e) => onChangeCypher(e.target.value)}
          placeholder="Enter Cypher statement (e.g. MATCH (n) RETURN n LIMIT 10)"
          className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs font-mono text-emerald-400 focus:outline-hidden focus:border-purple-500 shadow-inner"
        />
        <Button
          variant="purple"
          onClick={() => onExecuteCypher()}
          disabled={runningCypher}
          className="px-5 py-2.5 flex items-center gap-2"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>{runningCypher ? 'Executing...' : 'Run Query'}</span>
        </Button>
      </div>

      {/* Results View Card */}
      <Card className="p-4 bg-[#121420] border-slate-800 space-y-3">
        <div className="flex items-center justify-between pb-2.5 border-b border-slate-800">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-bold text-white uppercase tracking-wider">
              Query Result Table
            </span>
            {queryExecutionTimeMs !== null && (
              <Badge variant="success" className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                <span>{queryExecutionTimeMs} ms</span>
              </Badge>
            )}
            {cypherOutput && (
              <Badge variant="secondary">
                {cypherOutput.rows.length} rows returned
              </Badge>
            )}
          </div>

          {/* Table vs JSON Toggle */}
          <div className="flex items-center space-x-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px] font-mono">
            <button
              onClick={() => onToggleViewMode('table')}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                queryViewMode === 'table' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Table className="w-3 h-3" />
              <span>Table</span>
            </button>
            <button
              onClick={() => onToggleViewMode('json')}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                queryViewMode === 'json' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Code2 className="w-3 h-3" />
              <span>JSON</span>
            </button>
          </div>
        </div>

        {/* Formatted Data Table */}
        {queryViewMode === 'table' && cypherOutput && cypherOutput.columns.length > 0 && (
          <div className="overflow-x-auto max-h-64 custom-scrollbar rounded-lg border border-slate-800/80">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800 sticky top-0">
                <tr>
                  {cypherOutput.columns.map((col, idx) => (
                    <th key={idx} className="p-2.5 font-bold uppercase tracking-wider text-[11px]">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 bg-slate-950/60">
                {cypherOutput.rows.map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-slate-900/40 transition-colors">
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className="p-2.5 text-slate-200 truncate max-w-xs">
                        {typeof cell === 'object' && cell !== null
                          ? JSON.stringify(cell)
                          : String(cell ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Raw JSON Presentation */}
        {queryViewMode === 'json' && rawJsonOutput && (
          <pre className="bg-slate-950 p-3 rounded-lg border border-slate-800 font-mono text-xs text-emerald-300 overflow-x-auto max-h-64 custom-scrollbar">
            {JSON.stringify(rawJsonOutput, null, 2)}
          </pre>
        )}

        {!cypherOutput && !rawJsonOutput && (
          <div className="p-8 text-center text-xs text-slate-500 font-mono">
            Execute a Cypher statement above or click a preset to inspect live records.
          </div>
        )}
      </Card>
    </div>
  );
}
