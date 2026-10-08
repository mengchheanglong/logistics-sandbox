import React, { useState, useEffect, useRef } from 'react';
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
  Compass,
  ShoppingCart,
  Layers,
  Sparkles,
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import type { DeliveryCorridorPreset, OrderPriority } from '../types';

interface DispatchOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTrackVehicle?: (vehicleId: string) => void;
}

interface CatalogProduct {
  product_id: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  weight_kg: number;
}

const FALLBACK_PRESETS: DeliveryCorridorPreset[] = [
  {
    id: 'pp-depot-a-to-st271',
    name: 'Depot A → St 271 (Meanchey)',
    description: 'Central Market Depot A to St 271 south artery (Boeung Tumpun) • ~6.8 km',
    pickup: { name: 'Central Market Depot A', position: { lat: 11.5680, lon: 104.9223 } },
    delivery: { name: 'St 271 (Boeung Tumpun)', position: { lat: 11.5305, lon: 104.9085 } },
    suggestedPriority: 'urgent',
    defaultSlaMin: 15,
    tags: ['Ring Road', 'South Corridor', 'Urgent Blitz'],
  },
  {
    id: 'pp-depot-a-to-bkk1',
    name: 'Depot A → BKK1 (Pasteur)',
    description: 'Central Market Depot A to Pasteur / St 51 in BKK1 residential zone • ~2.1 km',
    pickup: { name: 'Central Market Depot A', position: { lat: 11.5680, lon: 104.9223 } },
    delivery: { name: 'BKK1 / Pasteur (St 51)', position: { lat: 11.5528, lon: 104.9282 } },
    suggestedPriority: 'express',
    defaultSlaMin: 30,
    tags: ['Commercial', 'Monivong Corridor', 'High Density'],
  },
  {
    id: 'pp-depot-b-to-tuolkork',
    name: 'Depot B → Tuol Kork (TK Ave)',
    description: 'Russian Market Depot B to Tuol Kork commercial center (St 289) • ~5.2 km',
    pickup: { name: 'Russian Market Depot B', position: { lat: 11.5435, lon: 104.9142 } },
    delivery: { name: 'Tuol Kork (TK Ave St 289)', position: { lat: 11.5732, lon: 104.8984 } },
    suggestedPriority: 'express',
    defaultSlaMin: 35,
    tags: ['Cross-town', 'Mao Tse Toung', 'Tech District'],
  },
  {
    id: 'pp-hub-to-riverside',
    name: 'Central Hub → Riverside Quay',
    description: 'Bak Touk Central Hub to Sisowath Quay riverfront promenade • ~2.4 km',
    pickup: { name: 'Bak Touk Central Hub', position: { lat: 11.5621, lon: 104.9160 } },
    delivery: { name: 'Riverside (Sisowath Quay)', position: { lat: 11.5695, lon: 104.9312 } },
    suggestedPriority: 'urgent',
    defaultSlaMin: 20,
    tags: ['Riverfront', 'Tourist Hub', 'Waterfront'],
  },
  {
    id: 'pp-depot-a-to-sensok',
    name: 'Depot A → Sen Sok (AEON 2)',
    description: 'Central Market Depot A along Russian Blvd to AEON Mall 2 in Sen Sok • ~6.4 km',
    pickup: { name: 'Central Market Depot A', position: { lat: 11.5680, lon: 104.9223 } },
    delivery: { name: 'Sen Sok (AEON Mall 2)', position: { lat: 11.5850, lon: 104.8820 } },
    suggestedPriority: 'standard',
    defaultSlaMin: 45,
    tags: ['Northwest', 'Russian Blvd', 'Suburban Mall'],
  },
  {
    id: 'pp-depot-b-to-norodom',
    name: 'Depot B → Independence Monument',
    description: 'Russian Market Depot B north along Mao Tse Toung to Norodom Blvd • ~2.3 km',
    pickup: { name: 'Russian Market Depot B', position: { lat: 11.5435, lon: 104.9142 } },
    delivery: { name: 'Independence Monument / Norodom', position: { lat: 11.5564, lon: 104.9282 } },
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

  // Corridor Presets State
  const [presets, setPresets] = useState<DeliveryCorridorPreset[]>(FALLBACK_PRESETS);
  const [selectedPresetId, setSelectedPresetId] = useState<string>(FALLBACK_PRESETS[0].id);

  // E-Commerce Marketplace Catalog State
  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>('P5004');
  const [ecommerceConnected, setEcommerceConnected] = useState<boolean>(false);

  // Form Fields State
  const [customerName, setCustomerName] = useState<string>('Sok Sovann');
  const [priority, setPriority] = useState<OrderPriority>('urgent');
  const [slaDurationMin, setSlaDurationMin] = useState<number>(15);
  const [itemCount, setItemCount] = useState<number>(1);
  const [weightKg, setWeightKg] = useState<number>(0.5);
  const [customItemName, setCustomItemName] = useState<string>('');

  // Submission & Result State
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [dispatchResult, setDispatchResult] = useState<{
    success: boolean;
    orderId?: string;
    assignedVehicleId?: string | null;
    message: string;
    ecommerceSynced?: boolean;
  } | null>(null);

  // Load Presets, Catalog & E-Commerce Status on Open
  useEffect(() => {
    if (!isOpen) return;

    // 1. Fetch Corridor Presets
    fetch('/api/orders/presets')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: DeliveryCorridorPreset[]) => {
        if (Array.isArray(data) && data.length > 0) {
          const sanitized = data.map((p) => ({
            ...p,
            tags: Array.isArray(p.tags) ? p.tags : ['Phnom Penh Corridor'],
            defaultSlaMin:
              p.defaultSlaMin ||
              (p.suggestedPriority === 'urgent' ? 15 : p.suggestedPriority === 'express' ? 35 : 120),
          }));
          setPresets(sanitized);
        }
      })
      .catch(() => {});

    // 2. Fetch Live E-Commerce Catalog from MongoDB
    fetch('/api/inventory/catalog')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.products && Array.isArray(data.products) && data.products.length > 0) {
          setCatalogProducts(data.products);
          setEcommerceConnected(!!data.connected);
          const firstInStock = data.products.find((p: CatalogProduct) => p.stock > 0);
          if (firstInStock) {
            setSelectedProductId(firstInStock.product_id);
            setWeightKg(firstInStock.weight_kg || 0.5);
          }
        }
      })
      .catch(() => {});

    // 3. Fetch E-Commerce Bridge Status
    fetch('/api/integrations/ecommerce/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((status) => {
        if (status) {
          setEcommerceConnected(!!status.connected);
        }
      })
      .catch(() => {});
  }, [isOpen]);

  // Synchronize Priority & SLA duration when Preset changes
  const handleSelectPreset = (preset: DeliveryCorridorPreset) => {
    setSelectedPresetId(preset.id);
    setPriority(preset.suggestedPriority);
    const sla =
      preset.defaultSlaMin ||
      (preset.suggestedPriority === 'urgent' ? 15 : preset.suggestedPriority === 'express' ? 35 : 120);
    setSlaDurationMin(sla);
    setDispatchResult(null);
    setError(null);
  };

  // Synchronize SLA duration when Priority changes
  const handleSelectPriority = (p: OrderPriority) => {
    setPriority(p);
    if (p === 'urgent') setSlaDurationMin(15);
    else if (p === 'express') setSlaDurationMin(35);
    else setSlaDurationMin(120);
  };

  // Update Item Weight & Info when Product changes
  const handleProductChange = (productId: string) => {
    setSelectedProductId(productId);
    if (productId === 'custom') {
      setCustomItemName('Special Express Package');
      setWeightKg(1.5);
      return;
    }
    const found = catalogProducts.find((p) => p.product_id === productId);
    if (found) {
      setWeightKg(found.weight_kg || 0.5);
    }
  };

  // Keyboard accessibility
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
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

  const currentPreset = presets.find((p) => p.id === selectedPresetId) || presets[0];
  const selectedProduct =
    selectedProductId !== 'custom'
      ? catalogProducts.find((p) => p.product_id === selectedProductId)
      : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setDispatchResult(null);

    const activePreset = presets.find((p) => p.id === selectedPresetId) || presets[0];

    const itemName =
      selectedProductId === 'custom'
        ? customItemName.trim() || 'Custom Parcel'
        : selectedProduct?.name || 'Traditional Khmer Herbal Inhaler & Refreshing Balm Duo';

    const itemPrice = selectedProduct?.price ?? 15.0;
    const itemWeight = Number(weightKg) || selectedProduct?.weight_kg || 0.5;

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
          totalWeight_kg: Math.round(itemWeight * itemCount * 10) / 10,
          items: [
            {
              product_id: selectedProductId !== 'custom' ? selectedProductId : 'P-CUSTOM',
              name: itemName,
              quantity: Number(itemCount) || 1,
              price: itemPrice,
              weight_kg: itemWeight,
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
        ecommerceSynced: data.ecommerceSynced ?? true,
      });
    } catch (err: any) {
      setError(err?.message || 'Error dispatching order');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dispatch-modal-title"
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-3 sm:p-5 overflow-hidden animate-in fade-in duration-200"
    >
      <div
        ref={modalRef}
        className="relative w-full max-w-5xl max-h-[92vh] flex flex-col rounded-2xl bg-[#0c0e17] border border-slate-700/70 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9),0_0_35px_rgba(6,182,212,0.18)] overflow-hidden"
      >
        {/* Top Header Bar */}
        <div className="h-16 px-6 shrink-0 border-b border-slate-800/90 bg-[#111322] flex items-center justify-between">
          <div className="flex items-center space-x-3.5">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 font-bold shadow-[0_0_12px_rgba(6,182,212,0.25)]">
              <Send className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <div className="flex items-center space-x-2.5">
                <h3
                  id="dispatch-modal-title"
                  className="text-base font-bold text-white tracking-wide"
                >
                  Phnom Penh Express Corridor Dispatch
                </h3>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold border transition-colors ${
                    ecommerceConnected
                      ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                      : 'bg-amber-950/80 text-amber-300 border-amber-500/40'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      ecommerceConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                    }`}
                  />
                  {ecommerceConnected ? 'MARKETPLACE: CONNECTED' : 'MARKETPLACE: STANDBY'}
                </span>
              </div>
              <div className="flex items-center space-x-2 text-xs text-slate-400 mt-0.5">
                <span>Real OSM turn-by-turn road routing</span>
                <span>•</span>
                <span className="text-cyan-400 font-mono">Earliest Deadline First (EDF)</span>
                <span>•</span>
                <span className="text-purple-300 font-mono">MongoDB Port 4000 Mirroring</span>
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body Container */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 text-xs text-slate-300 custom-scrollbar">
          {/* Post-dispatch Success Feedback Banner */}
          {dispatchResult && (
            <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/60 shadow-[0_0_25px_rgba(16,185,129,0.2)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="flex items-start gap-3.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-300 shrink-0 mt-0.5">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-emerald-300">
                      Order Injected & Dispatched!
                    </span>
                    {dispatchResult.orderId && (
                      <span className="px-2 py-0.5 rounded bg-emerald-900/60 font-mono text-[11px] font-bold text-emerald-200 border border-emerald-700/60">
                        {dispatchResult.orderId}
                      </span>
                    )}
                    {dispatchResult.ecommerceSynced && (
                      <span className="px-2 py-0.5 rounded bg-teal-950/80 text-teal-300 text-[10px] font-mono border border-teal-500/40 flex items-center gap-1">
                        <ShoppingCart className="w-3 h-3 text-teal-400" />
                        Mirrored to Marketplace (MongoDB)
                      </span>
                    )}
                  </div>
                  <p className="text-slate-300 text-xs mt-1">
                    {dispatchResult.message}
                  </p>
                  {dispatchResult.assignedVehicleId && (
                    <div className="flex items-center gap-2 mt-2 font-mono text-cyan-300 text-xs">
                      <Truck className="w-4 h-4 text-cyan-400" />
                      <span>Assigned Courier: <strong className="text-white text-sm">{dispatchResult.assignedVehicleId}</strong></span>
                      <span className="text-slate-500">|</span>
                      <span className="text-emerald-300 font-semibold">Active Road Navigation Started</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2.5 w-full sm:w-auto shrink-0">
                {dispatchResult.assignedVehicleId && onTrackVehicle && (
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    className="w-full sm:w-auto bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold px-4 py-2 shadow-[0_0_15px_rgba(6,182,212,0.4)]"
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
                  size="md"
                  onClick={() => setDispatchResult(null)}
                >
                  Dispatch Another
                </Button>
              </div>
            </div>
          )}

          {error && (
            <div className="p-3.5 rounded-xl bg-rose-950/50 border border-rose-500/60 flex items-center gap-3 text-rose-200">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* 1. Delivery Corridor Presets (2-Column Spacious Grid) */}
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-cyan-400" />
                  1. Select Phnom Penh Delivery Corridor
                </label>
                <span className="text-[11px] text-slate-400 font-mono">
                  {presets.length} Verified Physical Road Corridors
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {presets.map((preset) => {
                  const isSelected = selectedPresetId === preset.id;
                  return (
                    <div
                      key={preset.id}
                      onClick={() => handleSelectPreset(preset)}
                      className={`relative p-3.5 rounded-xl border text-left cursor-pointer transition-all duration-150 flex flex-col justify-between ${
                        isSelected
                          ? 'bg-cyan-950/40 border-cyan-500/80 shadow-[0_0_18px_rgba(6,182,212,0.22)] ring-1 ring-cyan-500/50'
                          : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900/90'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <span
                            className={`font-bold text-xs ${
                              isSelected ? 'text-cyan-300' : 'text-slate-200'
                            }`}
                          >
                            {preset.name}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                              preset.suggestedPriority === 'urgent'
                                ? 'bg-rose-950/90 text-rose-300 border border-rose-600/50'
                                : preset.suggestedPriority === 'express'
                                ? 'bg-amber-950/90 text-amber-300 border border-amber-600/50'
                                : 'bg-slate-800 text-slate-300 border border-slate-700'
                            }`}
                          >
                            {preset.suggestedPriority}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          {preset.description}
                        </p>
                      </div>

                      <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400 font-mono">
                        <span className="flex items-center gap-1.5 text-slate-300">
                          <Clock className="w-3.5 h-3.5 text-cyan-400" />
                          SLA Window:{' '}
                          <strong className="text-white">
                            {preset.defaultSlaMin ||
                              (preset.suggestedPriority === 'urgent'
                                ? 15
                                : preset.suggestedPriority === 'express'
                                ? 35
                                : 120)}{' '}
                            min
                          </strong>
                        </span>
                        <div className="flex items-center gap-1">
                          {(preset.tags || []).map((t) => (
                            <span
                              key={t}
                              className="px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-400 text-[10px]"
                            >
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

            {/* Active Corridor Geo Coordinates Preview */}
            {currentPreset && (
              <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800/90 flex flex-col sm:flex-row items-center justify-between gap-3 font-mono text-[11px]">
                <div className="flex items-center gap-2 text-slate-300">
                  <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_6px_#22d3ee]" />
                  <span className="text-slate-400">Pickup Depot:</span>
                  <span className="font-bold text-white">{currentPreset.pickup.name}</span>
                  <span className="text-slate-500">
                    ({currentPreset.pickup.position.lat.toFixed(4)},{' '}
                    {currentPreset.pickup.position.lon.toFixed(4)})
                  </span>
                </div>
                <ArrowRight className="w-4 h-4 text-cyan-400 shrink-0 hidden sm:block" />
                <div className="flex items-center gap-2 text-slate-300">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_6px_#fbbf24]" />
                  <span className="text-slate-400">Destination:</span>
                  <span className="font-bold text-white">{currentPreset.delivery.name}</span>
                  <span className="text-slate-500">
                    ({currentPreset.delivery.position.lat.toFixed(4)},{' '}
                    {currentPreset.delivery.position.lon.toFixed(4)})
                  </span>
                </div>
              </div>
            )}

            {/* 2 & 3. Split Grid: Priority & Real E-Commerce Product Selection */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Left Column: Priority & SLA Deadline */}
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                  <Flame className="w-4 h-4 text-amber-400" />
                  2. Priority & SLA Delivery Window
                </label>

                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => handleSelectPriority('urgent')}
                    className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                      priority === 'urgent'
                        ? 'bg-rose-950/60 border-rose-500 text-rose-200 shadow-[0_0_12px_rgba(244,63,94,0.3)] ring-1 ring-rose-500/50'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="font-bold text-xs flex items-center justify-center gap-1">
                      <Zap className="w-3.5 h-3.5 text-rose-400" />
                      Urgent
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5 font-mono">15 min SLA</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSelectPriority('express')}
                    className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                      priority === 'express'
                        ? 'bg-amber-950/60 border-amber-500 text-amber-200 shadow-[0_0_12px_rgba(245,158,11,0.3)] ring-1 ring-amber-500/50'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="font-bold text-xs flex items-center justify-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-amber-400" />
                      Express
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5 font-mono">35 min SLA</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSelectPriority('standard')}
                    className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                      priority === 'standard'
                        ? 'bg-blue-950/60 border-blue-500 text-blue-200 shadow-[0_0_12px_rgba(59,130,246,0.3)] ring-1 ring-blue-500/50'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="font-bold text-xs flex items-center justify-center gap-1">
                      <Package className="w-3.5 h-3.5 text-blue-400" />
                      Standard
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5 font-mono">2 hr SLA</div>
                  </button>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1 text-slate-300 font-mono text-[11px]">
                    <span>Custom SLA Delivery Window:</span>
                    <span className="font-bold text-cyan-300">{slaDurationMin} minutes</span>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="180"
                    step="5"
                    value={slaDurationMin}
                    onChange={(e) => setSlaDurationMin(Number(e.target.value))}
                    className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-1">
                    <span>5m (Rush Blitz)</span>
                    <span>30m</span>
                    <span>60m</span>
                    <span>180m</span>
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                    Customer / Recipient Name
                  </label>
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Recipient Name (e.g. Sok Sovann)"
                    className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/40 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 outline-hidden transition-all"
                    required
                  />
                </div>
              </div>

              {/* Right Column: Live E-Commerce Catalog Product Selection */}
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                    <ShoppingCart className="w-4 h-4 text-cyan-400" />
                    3. Marketplace Product Selection
                  </label>
                  <span className="text-[10px] text-teal-300 font-mono flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-teal-400" />
                    {catalogProducts.length > 0 ? `${catalogProducts.length} Items Live` : 'Standby'}
                  </span>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                    Select Catalog Product (MongoDB on Port 4000)
                  </label>
                  <select
                    value={selectedProductId}
                    onChange={(e) => handleProductChange(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/40 rounded-lg px-3 py-2 text-xs text-white outline-hidden cursor-pointer"
                  >
                    {catalogProducts.length > 0 ? (
                      catalogProducts.map((p) => (
                        <option key={p.product_id} value={p.product_id} className="bg-slate-950 text-slate-200">
                          {p.name} — ${p.price.toFixed(2)} ({p.stock > 0 ? `${p.stock} in stock` : 'Out of stock'})
                        </option>
                      ))
                    ) : (
                      <>
                        <option value="P5004">Traditional Khmer Herbal Inhaler & Refreshing Balm Duo — $5.50</option>
                        <option value="P5005">Kampot Sea Salt Body Scrub 250g — $11.50</option>
                        <option value="P0874">Battambang Jasmine Fragrant Rice 5kg — $4.80</option>
                        <option value="P3314">Premium Linen Casual Shirt — $18.50</option>
                      </>
                    )}
                    <option value="custom">📦 Custom Express Package / Medication (Manual)</option>
                  </select>
                </div>

                {selectedProductId === 'custom' && (
                  <div>
                    <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                      Custom Item Name
                    </label>
                    <input
                      type="text"
                      value={customItemName}
                      onChange={(e) => setCustomItemName(e.target.value)}
                      placeholder="e.g. Urgent Pharmacy Supplies"
                      className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-lg px-3 py-1.5 text-xs text-white outline-hidden"
                    />
                  </div>
                )}

                {/* Live Product Attributes Summary */}
                {selectedProduct && (
                  <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-300">
                    <div>
                      <span className="text-slate-500">Unit Price:</span>{' '}
                      <strong className="text-emerald-400 font-bold">${selectedProduct.price.toFixed(2)}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500">Category:</span>{' '}
                      <span className="text-slate-300">{selectedProduct.category}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Live Stock:</span>{' '}
                      <span className={selectedProduct.stock > 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                        {selectedProduct.stock} units
                      </span>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                      Quantity (units)
                    </label>
                    <input
                      type="number"
                      min="1"
                      max={selectedProduct?.stock && selectedProduct.stock > 0 ? Math.min(10, selectedProduct.stock) : 10}
                      value={itemCount}
                      onChange={(e) => setItemCount(Math.max(1, Number(e.target.value)))}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-lg px-3 py-1.5 text-xs text-white outline-hidden font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                      Weight per unit (kg)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      max="35"
                      value={weightKg}
                      onChange={(e) => setWeightKg(Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-lg px-3 py-1.5 text-xs text-white outline-hidden font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Action Footer Bar */}
            <div className="pt-3 border-t border-slate-800/90 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
                <span className="flex items-center gap-1 text-cyan-300">
                  <Layers className="w-3.5 h-3.5 text-cyan-400" />
                  Routing: osm-pathfinder (CH / Bi-A*)
                </span>
                <span>•</span>
                <span className="text-purple-300">
                  Auto-Mirroring to MongoDB: {ecommerceConnected ? 'Active' : 'Offline'}
                </span>
              </div>

              <div className="flex items-center gap-2.5 w-full sm:w-auto">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  disabled={submitting}
                  className="w-full sm:w-auto"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={submitting}
                  className="w-full sm:w-auto bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold px-6 py-2 shadow-[0_0_15px_rgba(6,182,212,0.35)]"
                >
                  {submitting ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin mr-2" />
                      Routing & Assigning Courier...
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
