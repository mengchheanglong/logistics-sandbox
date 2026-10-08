import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Send,
  X,
  MapPin,
  Clock,
  Zap,
  Package,
  CheckCircle2,
  AlertCircle,
  Truck,
  ArrowRight,
  Flame,
  Radio,
  Compass,
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import type { DeliveryCorridorPreset, OrderPriority } from '../types';

interface DispatchOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTrackVehicle?: (vehicleId: string) => void;
}

const FALLBACK_PRESETS: DeliveryCorridorPreset[] = [
  {
    id: 'pp-depot-a-to-st271',
    name: 'Depot A → St 271 (Meanchey)',
    description: 'South Phnom Penh delivery corridor connecting Central Market to St 271 ring road',
    pickup: { name: 'Central Depot A', position: { lat: 11.5680, lon: 104.9223 } },
    delivery: { name: 'St 271 Meanchey Retail Hub', position: { lat: 11.5305, lon: 104.9085 } },
    suggestedPriority: 'urgent',
    defaultSlaMin: 15,
    tags: ['Ring Road', 'South Corridor', 'Urgent Blitz'],
  },
  {
    id: 'pp-depot-a-to-bkk1',
    name: 'Depot A → BKK1 (Pasteur)',
    description: 'High-density commercial corridor via Preah Monivong Blvd into Boeung Keng Kang 1',
    pickup: { name: 'Central Depot A', position: { lat: 11.5680, lon: 104.9223 } },
    delivery: { name: 'BKK1 Pasteur Avenue', position: { lat: 11.5528, lon: 104.9282 } },
    suggestedPriority: 'express',
    defaultSlaMin: 30,
    tags: ['Commercial', 'Monivong Corridor', 'High Density'],
  },
  {
    id: 'pp-depot-b-to-tuolkork',
    name: 'Depot B → Tuol Kork (TK Ave)',
    description: 'Southwest-to-Northwest diagonal cross-town dispatch via Mao Tse Toung Blvd',
    pickup: { name: 'South Depot B', position: { lat: 11.5435, lon: 104.9142 } },
    delivery: { name: 'TK Avenue Mall, Tuol Kork', position: { lat: 11.5732, lon: 104.8984 } },
    suggestedPriority: 'express',
    defaultSlaMin: 35,
    tags: ['Cross-town', 'Mao Tse Toung', 'Tech District'],
  },
  {
    id: 'pp-hub-to-riverside',
    name: 'Central Hub → Riverside Quay',
    description: 'Express courier delivery along Sisowath Quay and the Tonle Sap riverfront',
    pickup: { name: 'Phnom Penh Central Hub', position: { lat: 11.5621, lon: 104.9160 } },
    delivery: { name: 'Sisowath Quay Riverside', position: { lat: 11.5695, lon: 104.9312 } },
    suggestedPriority: 'urgent',
    defaultSlaMin: 20,
    tags: ['Riverfront', 'Tourist Hub', 'Waterfront'],
  },
  {
    id: 'pp-depot-a-to-sensok',
    name: 'Depot A → Sen Sok (AEON 2)',
    description: 'Suburban arterial corridor heading Northwest via Russian Blvd to AEON Mall Sen Sok',
    pickup: { name: 'Central Depot A', position: { lat: 11.5680, lon: 104.9223 } },
    delivery: { name: 'AEON Mall Sen Sok City', position: { lat: 11.5850, lon: 104.8820 } },
    suggestedPriority: 'standard',
    defaultSlaMin: 45,
    tags: ['Northwest', 'Russian Blvd', 'Suburban Mall'],
  },
  {
    id: 'pp-depot-b-to-norodom',
    name: 'Depot B → Independence Monument',
    description: 'Diplomatic & government ministry corridor traversing Preah Sihanouk & Preah Norodom Blvd',
    pickup: { name: 'South Depot B', position: { lat: 11.5435, lon: 104.9142 } },
    delivery: { name: 'Independence Monument Circle', position: { lat: 11.5564, lon: 104.9282 } },
    suggestedPriority: 'express',
    defaultSlaMin: 25,
    tags: ['Diplomatic', 'Norodom Blvd', 'City Center'],
  },
];

export function DispatchOrderModal({
  isOpen,
  onClose,
  onTrackVehicle,
}: DispatchOrderModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [presets, setPresets] = useState<DeliveryCorridorPreset[]>(FALLBACK_PRESETS);
  const [selectedPresetId, setSelectedPresetId] = useState<string>(FALLBACK_PRESETS[0].id);
  const [customerName, setCustomerName] = useState<string>('Sok Sovann');
  const [priority, setPriority] = useState<OrderPriority>('urgent');
  const [slaDurationMin, setSlaDurationMin] = useState<number>(15);
  const [itemCategory, setItemCategory] = useState<string>('Express Electronics & Meds');
  const [itemCount, setItemCount] = useState<number>(2);
  const [weightKg, setWeightKg] = useState<number>(1.8);

  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [dispatchResult, setDispatchResult] = useState<{
    success: boolean;
    orderId?: string;
    assignedVehicleId?: string | null;
    message: string;
  } | null>(null);

  // Fetch presets from backend API on mount/open
  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/orders/presets')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load corridor presets');
        return res.json();
      })
      .then((data: DeliveryCorridorPreset[]) => {
        if (Array.isArray(data) && data.length > 0) {
          setPresets(data);
        }
      })
      .catch(() => {
        // Fallback already pre-set
      });
  }, [isOpen]);

  // Synchronize priority & SLA duration when preset changes
  const handleSelectPreset = (preset: DeliveryCorridorPreset) => {
    setSelectedPresetId(preset.id);
    setPriority(preset.suggestedPriority);
    setSlaDurationMin(preset.defaultSlaMin);
    setDispatchResult(null);
    setError(null);
  };

  // Synchronize SLA duration when priority radio changes
  const handleSelectPriority = (p: OrderPriority) => {
    setPriority(p);
    if (p === 'urgent') setSlaDurationMin(15);
    else if (p === 'express') setSlaDurationMin(35);
    else setSlaDurationMin(120);
  };

  // Keyboard accessibility: Escape key closes modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Light-dismiss click on backdrop
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
      onClose();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setDispatchResult(null);

    const activePreset = presets.find((p) => p.id === selectedPresetId) || presets[0];

    try {
      const res = await fetch('/api/orders/inject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          presetId: activePreset.id,
          pickupLocation: activePreset.pickup.position,
          deliveryLocation: activePreset.delivery.position,
          customerName: customerName.trim() || 'Express Customer',
          priority,
          slaDurationMin,
          totalWeight_kg: Number(weightKg) || 2.0,
          items: [
            {
              name: itemCategory,
              quantity: Number(itemCount) || 1,
              weight_kg: Number(weightKg) || 2.0,
            },
          ],
        }),
      });

      const data = await res.json();
      if (!res.ok || data.success === false) {
        throw new Error(data.message || 'Failed to inject custom order');
      }

      setDispatchResult({
        success: true,
        orderId: data.order?.id,
        assignedVehicleId: data.assignedVehicleId,
        message: data.message,
      });
    } catch (err: any) {
      setError(err?.message || 'Error dispatching order');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const currentPreset = presets.find((p) => p.id === selectedPresetId) || presets[0];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dispatch-modal-title"
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 sm:p-6 overflow-hidden animate-in fade-in duration-200"
    >
      <div
        ref={modalRef}
        className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl bg-[#0d0f17] border border-slate-700/80 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9),0_0_35px_rgba(6,182,212,0.18)] overflow-hidden"
      >
        {/* Header Bar */}
        <div className="h-16 px-6 shrink-0 border-b border-slate-800 bg-[#121420] flex items-center justify-between">
          <div className="flex items-center space-x-3.5">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 font-bold shadow-[0_0_12px_rgba(6,182,212,0.2)]">
              <Send className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <div className="flex items-center space-x-2.5">
                <h3
                  id="dispatch-modal-title"
                  className="text-base font-bold text-white tracking-wide"
                >
                  Phnom Penh Corridor Dispatch
                </h3>
                <Badge variant="cyan">EXPRESS INJECTION</Badge>
              </div>
              <div className="flex items-center space-x-2 text-xs text-slate-400 mt-0.5">
                <span>Inject targeted delivery orders along verified OSM road networks</span>
                <span>•</span>
                <span className="text-cyan-400 font-mono">osm-pathfinder engine</span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs text-slate-300">
          {/* Post-dispatch Success Feedback Banner */}
          {dispatchResult && (
            <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.15)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-emerald-300">
                      Order Successfully Injected & Dispatched!
                    </span>
                    {dispatchResult.orderId && (
                      <span className="px-2 py-0.5 rounded bg-emerald-900/60 font-mono text-[11px] text-emerald-200 border border-emerald-700/50">
                        {dispatchResult.orderId}
                      </span>
                    )}
                  </div>
                  <p className="text-slate-300 text-xs mt-1">
                    {dispatchResult.message}
                  </p>
                  {dispatchResult.assignedVehicleId && (
                    <div className="flex items-center gap-2 mt-2 font-mono text-cyan-300">
                      <Truck className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Assigned Courier: <strong className="text-white">{dispatchResult.assignedVehicleId}</strong></span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
                {dispatchResult.assignedVehicleId && onTrackVehicle && (
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    className="w-full sm:w-auto bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold shadow-[0_0_15px_rgba(6,182,212,0.4)]"
                    onClick={() => {
                      onTrackVehicle(dispatchResult.assignedVehicleId!);
                      onClose();
                    }}
                  >
                    <Compass className="w-4 h-4 mr-1.5" />
                    Track Courier in 3D
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDispatchResult(null)}
                >
                  Dispatch Another
                </Button>
              </div>
            </div>
          )}

          {error && (
            <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-500/50 flex items-center gap-3 text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Step 1: Corridor Preset Selection */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-cyan-400" />
                  1. Select Phnom Penh Delivery Corridor
                </label>
                <span className="text-[11px] text-slate-400">
                  {presets.length} Presets Available
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {presets.map((preset) => {
                  const isSelected = selectedPresetId === preset.id;
                  return (
                    <div
                      key={preset.id}
                      onClick={() => handleSelectPreset(preset)}
                      className={`relative p-3.5 rounded-xl border text-left cursor-pointer transition-all duration-150 flex flex-col justify-between ${
                        isSelected
                          ? 'bg-cyan-950/30 border-cyan-500/70 shadow-[0_0_15px_rgba(6,182,212,0.2)]'
                          : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900/90'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-1 mb-1.5">
                          <span className={`font-bold text-xs ${isSelected ? 'text-cyan-300' : 'text-slate-200'}`}>
                            {preset.name}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                              preset.suggestedPriority === 'urgent'
                                ? 'bg-rose-950/80 text-rose-300 border border-rose-600/40'
                                : preset.suggestedPriority === 'express'
                                ? 'bg-amber-950/80 text-amber-300 border border-amber-600/40'
                                : 'bg-slate-800 text-slate-300 border border-slate-700'
                            }`}
                          >
                            {preset.suggestedPriority}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                          {preset.description}
                        </p>
                      </div>

                      <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400">
                        <span className="flex items-center gap-1 text-slate-300">
                          <Clock className="w-3 h-3 text-cyan-400" />
                          SLA {preset.defaultSlaMin} min
                        </span>
                        <div className="flex items-center gap-1">
                          {preset.tags.slice(0, 1).map((t) => (
                            <span key={t} className="px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-400">
                              {t}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Selected Route Preview Card */}
            {currentPreset && (
              <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 font-mono text-[11px]">
                <div className="flex items-center gap-2 text-slate-300">
                  <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_6px_#22d3ee]" />
                  <span className="text-slate-400">Origin:</span>
                  <span className="font-bold text-white">{currentPreset.pickup.name}</span>
                  <span className="text-slate-500">({currentPreset.pickup.position.lat.toFixed(4)}, {currentPreset.pickup.position.lon.toFixed(4)})</span>
                </div>
                <ArrowRight className="w-4 h-4 text-cyan-400 shrink-0 hidden sm:block" />
                <div className="flex items-center gap-2 text-slate-300">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_6px_#fbbf24]" />
                  <span className="text-slate-400">Destination:</span>
                  <span className="font-bold text-white">{currentPreset.delivery.name}</span>
                  <span className="text-slate-500">({currentPreset.delivery.position.lat.toFixed(4)}, {currentPreset.delivery.position.lon.toFixed(4)})</span>
                </div>
              </div>
            )}

            {/* Step 2: Priority, SLA & Order Payload */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Left Column: Priority & Delivery Window */}
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-4">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <Flame className="w-4 h-4 text-amber-400" />
                  2. Priority & SLA Delivery Window
                </label>

                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => handleSelectPriority('urgent')}
                    className={`p-2.5 rounded-lg border text-center transition-all cursor-pointer ${
                      priority === 'urgent'
                        ? 'bg-rose-950/60 border-rose-500 text-rose-300 shadow-[0_0_12px_rgba(244,63,94,0.3)]'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="font-bold text-xs flex items-center justify-center gap-1">
                      <Zap className="w-3.5 h-3.5 text-rose-400" />
                      Urgent
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">15 min SLA</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSelectPriority('express')}
                    className={`p-2.5 rounded-lg border text-center transition-all cursor-pointer ${
                      priority === 'express'
                        ? 'bg-amber-950/60 border-amber-500 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="font-bold text-xs flex items-center justify-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-amber-400" />
                      Express
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">35 min SLA</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSelectPriority('standard')}
                    className={`p-2.5 rounded-lg border text-center transition-all cursor-pointer ${
                      priority === 'standard'
                        ? 'bg-blue-950/60 border-blue-500 text-blue-300 shadow-[0_0_12px_rgba(59,130,246,0.3)]'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="font-bold text-xs flex items-center justify-center gap-1">
                      <Package className="w-3.5 h-3.5 text-blue-400" />
                      Standard
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">2 hr SLA</div>
                  </button>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1 text-slate-400">
                    <span>Custom SLA Window:</span>
                    <span className="font-mono font-bold text-cyan-300">{slaDurationMin} minutes</span>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="180"
                    step="5"
                    value={slaDurationMin}
                    onChange={(e) => setSlaDurationMin(Number(e.target.value))}
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-0.5">
                    <span>5m (Rush)</span>
                    <span>30m</span>
                    <span>60m</span>
                    <span>180m</span>
                  </div>
                </div>
              </div>

              {/* Right Column: Customer & Parcel Details */}
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <Package className="w-4 h-4 text-cyan-400" />
                  3. Customer & Package Details
                </label>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Customer / Recipient Name</label>
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Customer Name (e.g. Sok Sovann)"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-hidden focus:border-cyan-500"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Item Category</label>
                    <input
                      type="text"
                      value={itemCategory}
                      onChange={(e) => setItemCategory(e.target.value)}
                      placeholder="e.g. Electronics"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-hidden focus:border-cyan-500"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Weight (kg)</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0.2"
                      max="35"
                      value={weightKg}
                      onChange={(e) => setWeightKg(Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-hidden focus:border-cyan-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Quantity</label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={itemCount}
                    onChange={(e) => setItemCount(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-hidden focus:border-cyan-500"
                  />
                </div>
              </div>
            </div>

            {/* Submit Bar */}
            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
              <div className="text-[11px] text-slate-400">
                <span>Dispatch Algorithm: </span>
                <span className="font-mono text-cyan-300 font-semibold">Earliest Deadline First (EDF) + Nearest Courier</span>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={submitting}
                  className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold px-5"
                >
                  {submitting ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin mr-2" />
                      Routing & Assigning...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-1.5" />
                      Dispatch Express Order
                    </>
                  )}
                </Button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
