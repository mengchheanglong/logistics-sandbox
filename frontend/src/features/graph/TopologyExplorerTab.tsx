import React, { useState, useMemo } from 'react';
import { Search, Building2, Truck, User, Users, MapPin, X } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Card } from '../../components/ui/card';

interface GraphNodeItem {
  id: string;
  label: string;
  properties: Record<string, any>;
}

interface TopologyExplorerTabProps {
  nodes: GraphNodeItem[];
  loading: boolean;
}

export function TopologyExplorerTab({ nodes, loading }: TopologyExplorerTabProps) {
  const [nodeFilter, setNodeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const filteredNodes = useMemo(() => {
    return nodes.filter((node) => {
      const matchesType =
        nodeFilter === 'all' || node.label.toLowerCase() === nodeFilter.toLowerCase();
      const name = String(node.properties.name || node.id || '').toLowerCase();
      const id = String(node.id).toLowerCase();
      const matchesSearch =
        !searchQuery ||
        name.includes(searchQuery.toLowerCase()) ||
        id.includes(searchQuery.toLowerCase());
      return matchesType && matchesSearch;
    });
  }, [nodes, nodeFilter, searchQuery]);

  const getNodeIcon = (label: string) => {
    switch (label.toLowerCase()) {
      case 'depot':
      case 'warehouse':
        return <Building2 className="w-3.5 h-3.5 text-purple-400" />;
      case 'vehicle':
        return <Truck className="w-3.5 h-3.5 text-cyan-400" />;
      case 'driver':
        return <User className="w-3.5 h-3.5 text-emerald-400" />;
      case 'customer':
        return <Users className="w-3.5 h-3.5 text-amber-400" />;
      default:
        return <MapPin className="w-3.5 h-3.5 text-slate-400" />;
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-150">
      {/* Filter Chips & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900/90 border border-slate-800 p-3 rounded-xl">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {['all', 'Warehouse', 'Depot', 'Vehicle', 'Driver', 'Customer'].map((type) => (
            <button
              key={type}
              onClick={() => setNodeFilter(type)}
              className={`px-3 py-1.5 rounded-lg font-semibold capitalize transition-all cursor-pointer ${
                nodeFilter === type
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {type}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search node ID or name..."
            className="w-full sm:w-64 bg-slate-950 border border-slate-800 text-white text-xs rounded-lg pl-8 pr-8 py-1.5 focus:outline-hidden focus:border-purple-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1.5 text-slate-400 hover:text-white text-xs"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Grid of Nodes */}
      {loading ? (
        <div className="p-12 text-center text-xs text-slate-500 font-mono">
          Loading graph topology from Neo4j...
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[460px] overflow-y-auto pr-1 custom-scrollbar">
          {filteredNodes.map((node) => {
            const isDepot = node.label === 'Depot' || node.label === 'Warehouse';
            const isVehicle = node.label === 'Vehicle';
            const isDriver = node.label === 'Driver';
            const isCustomer = node.label === 'Customer';

            return (
              <Card
                key={node.id}
                className="p-3.5 bg-[#121420] border-slate-800 hover:border-purple-500/50 transition-all space-y-2 group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    {getNodeIcon(node.label)}
                    <span className="font-bold text-white font-mono text-xs group-hover:text-purple-300 transition-colors">
                      {node.id}
                    </span>
                  </div>
                  <Badge variant={isDepot ? 'purple' : isVehicle ? 'cyan' : isDriver ? 'success' : 'warning'}>
                    {node.label}
                  </Badge>
                </div>

                <p className="text-xs text-slate-200 font-semibold truncate">
                  {node.properties.name || node.id}
                </p>

                <div className="pt-2 border-t border-slate-800/80 grid grid-cols-2 gap-1 text-[11px] font-mono text-slate-400">
                  {isDepot && (
                    <>
                      <span>Stock: <strong className="text-slate-200">{node.properties.currentStock}</strong></span>
                      <span>Cap: <strong className="text-slate-200">{node.properties.capacity}</strong></span>
                    </>
                  )}
                  {isVehicle && (
                    <>
                      <span>Type: <strong className="text-slate-200">{node.properties.type}</strong></span>
                      <span>Speed: <strong className="text-slate-200">{node.properties.speed_kmh}km/h</strong></span>
                    </>
                  )}
                  {isDriver && (
                    <>
                      <span>Status: <strong className="text-emerald-400">{node.properties.status}</strong></span>
                      <span>Shift: <strong className="text-slate-200">8h Active</strong></span>
                    </>
                  )}
                  {isCustomer && (
                    <>
                      <span>City: <strong className="text-slate-200">{node.properties.city || 'Phnom Penh'}</strong></span>
                      <span>Tier: <strong className="text-amber-400">{node.properties.tier || 'VIP Gold'}</strong></span>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
