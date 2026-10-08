import React, { useState } from 'react';
import { Zap, AlertTriangle, Truck, Package, Clock, DollarSign, CheckCircle2, Copy, Check, ShieldAlert } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import type { ImpactAnalysisResult, Vehicle } from '../../types';

interface ImpactSimulatorTabProps {
  vehicles: Vehicle[];
  impactResult: ImpactAnalysisResult | null;
  simulatingImpact: boolean;
  selectedType: 'depot' | 'vehicle';
  selectedId: string;
  onSelectType: (type: 'depot' | 'vehicle') => void;
  onSelectId: (id: string) => void;
  onRunImpact: (type: 'depot' | 'vehicle', id: string) => void;
}

export function ImpactSimulatorTab({
  vehicles,
  impactResult,
  simulatingImpact,
  selectedType,
  selectedId,
  onSelectType,
  onSelectId,
  onRunImpact,
}: ImpactSimulatorTabProps) {
  const [copiedQuery, setCopiedQuery] = useState(false);

  return (
    <div className="space-y-5 animate-in fade-in duration-150">
      {/* Target Failure Entity Selection Header */}
      <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <ShieldAlert className="w-4 h-4 text-purple-400" />
            <h4 className="text-sm font-bold text-white tracking-wide">
              Failure Injection & Cascade Traversal
            </h4>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Simulate an asset disruption to compute downstream logistics delays with index-free graph traversal
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => {
                onSelectType('depot');
                onSelectId('depot-a');
                onRunImpact('depot', 'depot-a');
              }}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                selectedType === 'depot'
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              🏢 Depot Hub
            </button>
            <button
              onClick={() => {
                onSelectType('vehicle');
                const defaultV = vehicles[0]?.id || 'TRUCK-001';
                onSelectId(defaultV);
                onRunImpact('vehicle', defaultV);
              }}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                selectedType === 'vehicle'
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              🚚 Courier Vehicle
            </button>
          </div>

          <select
            value={selectedId}
            onChange={(e) => {
              onSelectId(e.target.value);
              onRunImpact(selectedType, e.target.value);
            }}
            className="bg-slate-950 border border-slate-800 text-white text-xs rounded-xl px-3 py-2 font-mono focus:outline-hidden focus:border-purple-500 cursor-pointer"
          >
            {selectedType === 'depot' ? (
              <>
                <option value="depot-a">Depot A — Central Market (Daun Penh)</option>
                <option value="depot-b">Depot B — Russian Market (Toul Tom Poung)</option>
              </>
            ) : (
              vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.type.toUpperCase()} • {v.driverId})
                </option>
              ))
            )}
          </select>

          <Button
            variant="destructive"
            onClick={() => onRunImpact(selectedType, selectedId)}
            disabled={simulatingImpact}
            className="flex items-center gap-1.5"
          >
            <Zap className="w-3.5 h-3.5 fill-current" />
            <span>{simulatingImpact ? 'Traversing...' : 'Simulate Failure'}</span>
          </Button>
        </div>
      </div>

      {/* 4 Clean Metric Cards */}
      {impactResult && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
          <Card className="p-4 border-slate-800/80">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase font-bold text-slate-400">
                Traversal Speed
              </span>
              <Clock className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="flex items-baseline space-x-1.5 mt-2">
              <span className="text-2xl font-bold font-mono text-emerald-400">
                {impactResult.traversalTimeMs}
              </span>
              <span className="text-xs font-mono text-slate-400">ms</span>
            </div>
            <Badge variant="success" className="mt-2">
              O(1) memory pointers
            </Badge>
          </Card>

          <Card className="p-4 border-slate-800/80">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase font-bold text-slate-400">
                Stranded Vehicles
              </span>
              <Truck className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="flex items-baseline space-x-1.5 mt-2">
              <span className="text-2xl font-bold font-mono text-amber-400">
                {impactResult.impactedVehicles.length}
              </span>
              <span className="text-xs font-mono text-slate-400">units</span>
            </div>
            <Badge variant="warning" className="mt-2">
              Requires re-homing
            </Badge>
          </Card>

          <Card className="p-4 border-slate-800/80">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase font-bold text-slate-400">
                Orders Delayed
              </span>
              <Package className="w-3.5 h-3.5 text-rose-400" />
            </div>
            <div className="flex items-baseline space-x-1.5 mt-2">
              <span className="text-2xl font-bold font-mono text-rose-400">
                {impactResult.totalOrdersAtRisk}
              </span>
              <span className="text-xs font-mono text-slate-400">packages</span>
            </div>
            <span className="text-[11px] text-slate-400 block mt-2 font-mono">
              {impactResult.totalPayloadKg} kg cargo at risk
            </span>
          </Card>

          <Card className="p-4 border-slate-800/80">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase font-bold text-slate-400">
                Revenue Exposure
              </span>
              <DollarSign className="w-3.5 h-3.5 text-purple-300" />
            </div>
            <div className="flex items-baseline space-x-1 mt-2">
              <span className="text-2xl font-bold font-mono text-purple-300">
                ${impactResult.estimatedRevenueAtRiskUSD}
              </span>
            </div>
            <span className="text-[11px] text-slate-400 block mt-2 font-mono">
              {impactResult.impactedCustomers.length} customers affected
            </span>
          </Card>
        </div>
      )}

      {/* Two Column Detailed Breakdown */}
      {impactResult && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Left Column: Affected Vehicles */}
          <div className="bg-[#121420] border border-slate-800 rounded-xl p-4.5 space-y-3">
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <Truck className="w-4 h-4 text-amber-400" />
                <h5 className="text-xs font-bold text-white uppercase tracking-wider">
                  Impacted Couriers ({impactResult.impactedVehicles.length} Units)
                </h5>
              </div>
              <Badge variant="secondary">Target: {impactResult.targetEntity.name}</Badge>
            </div>

            <div className="space-y-2 max-h-56 overflow-y-auto pr-1 custom-scrollbar">
              {impactResult.impactedVehicles.length > 0 ? (
                impactResult.impactedVehicles.map((v) => (
                  <div
                    key={v.id}
                    className="bg-slate-900/90 border border-slate-800 p-2.5 rounded-lg flex items-center justify-between text-xs hover:border-slate-700 transition-colors"
                  >
                    <div className="flex items-center space-x-2.5">
                      <span className="w-2 h-2 rounded-full bg-amber-400" />
                      <div>
                        <span className="font-bold text-white font-mono">{v.id}</span>
                        <span className="text-slate-400 text-[11px] block">
                          Driver: <strong className="text-slate-200">{v.driverName || 'Assigned'}</strong>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 font-mono text-[11px]">
                      <Badge variant="outline">{v.type}</Badge>
                      <span className="text-slate-400">Load: {v.currentLoad_kg}kg</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-4 text-center text-xs text-slate-500">
                  No vehicles directly affected by this target.
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Delayed Orders */}
          <div className="bg-[#121420] border border-slate-800 rounded-xl p-4.5 space-y-3">
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <Package className="w-4 h-4 text-rose-400" />
                <h5 className="text-xs font-bold text-white uppercase tracking-wider">
                  Delayed Deliveries ({impactResult.impactedOrders.length} Orders)
                </h5>
              </div>
              <Badge variant="secondary">{impactResult.impactedCustomers.length} Customers</Badge>
            </div>

            <div className="space-y-2 max-h-56 overflow-y-auto pr-1 custom-scrollbar">
              {impactResult.impactedOrders.length > 0 ? (
                impactResult.impactedOrders.map((ord) => (
                  <div
                    key={ord.id}
                    className="bg-slate-900/90 border border-slate-800 p-2.5 rounded-lg flex items-center justify-between text-xs hover:border-slate-700 transition-colors"
                  >
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-white font-mono">{ord.id}</span>
                        <Badge variant="destructive">{ord.priority || 'Express'}</Badge>
                      </div>
                      <span className="text-slate-400 text-[11px] block mt-0.5">
                        Customer: <strong className="text-slate-200">{ord.customerId}</strong> ({ord.totalWeight_kg} kg)
                      </span>
                    </div>

                    <Badge variant="warning">{ord.status}</Badge>
                  </div>
                ))
              ) : (
                <div className="p-6 text-center text-xs text-slate-400 space-y-1.5 bg-slate-900/40 rounded-lg border border-slate-800/60">
                  <div className="flex items-center justify-center space-x-2 text-emerald-400 font-bold">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Zero Active Customer Orders Disrupted</span>
                  </div>
                  <span className="text-[11px] text-slate-500 block">
                    All {impactResult.impactedVehicles.length} vehicles stationed at this depot are currently idle. Reroute fleet safely to alternative distribution depots without delay.
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Generated Cypher Traversal Query Code Card */}
      {impactResult && (
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs text-slate-300 space-y-2 shadow-inner">
          <div className="flex items-center justify-between text-[11px] pb-2 border-b border-slate-800/80">
            <span className="font-bold text-slate-400 flex items-center space-x-1.5">
              <Zap className="w-3.5 h-3.5 text-purple-400" />
              <span>Real-Time Cypher Traversal Query Executed:</span>
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(impactResult.cypherQuery);
                setCopiedQuery(true);
                setTimeout(() => setCopiedQuery(false), 2000);
              }}
              className="h-6 text-[10px]"
            >
              {copiedQuery ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copiedQuery ? 'Copied' : 'Copy Cypher'}</span>
            </Button>
          </div>
          <pre className="text-emerald-300 overflow-x-auto whitespace-pre-wrap py-1 text-[11px] leading-relaxed">
            {impactResult.cypherQuery}
          </pre>
        </div>
      )}
    </div>
  );
}
