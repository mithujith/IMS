import React, { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  LogOut,
  MapPin,
  PackagePlus,
  RefreshCw,
  Sparkles,
  Warehouse as WarehouseIcon,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useOrg } from '../hooks/useOrg';

export function OrganizationSetupModal() {
  const { user, logout } = useAuth();
  const { completeOrgSetup, refreshOrg } = useOrg();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState('A & P Brothers (Pvt) Ltd');
  const [legalName, setLegalName] = useState('A & P Brothers (Pvt) Ltd');
  const [currency, setCurrency] = useState('LKR');
  const [email, setEmail] = useState(user?.email || 'sales@apbrothers.lk');
  const [phone, setPhone] = useState('+94 11 243 8890');

  const [address, setAddress] = useState('No. 142, Panchikawatta Road');
  const [city, setCity] = useState('Colombo 10');
  const [country, setCountry] = useState('Sri Lanka');
  const [taxId, setTaxId] = useState('VAT-114892034-7000');

  const [primaryWarehouseName, setPrimaryWarehouseName] = useState('Main Store');
  const [primaryWarehouseCode, setPrimaryWarehouseCode] = useState('WH-MAIN');
  const [includeShowroom, setIncludeShowroom] = useState(true);
  const [loadDemo, setLoadDemo] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleNext = () => {
    setError(null);
    if (step === 1) {
      if (!name.trim()) {
        setError('Organization name is required.');
        return;
      }
      setStep(2);
      return;
    }
    if (step === 2) {
      setStep(3);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step < 3) {
      handleNext();
      return;
    }
    if (!name.trim()) {
      setStep(1);
      setError('Organization name is required.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await completeOrgSetup({
        name: name.trim(),
        legalName: legalName.trim() || name.trim(),
        currency: currency.trim() || 'LKR',
        address: address.trim(),
        city: city.trim(),
        country: country.trim() || 'Sri Lanka',
        phone: phone.trim(),
        email: email.trim(),
        taxId: taxId.trim(),
        primaryWarehouseName: primaryWarehouseName.trim() || 'Main Store',
        primaryWarehouseCode: primaryWarehouseCode.trim() || 'WH-MAIN',
        includeShowroom,
        loadDemo,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to create organization workspace. Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleRecheckInvites = async () => {
    setError(null);
    setRechecking(true);
    try {
      await refreshOrg();
    } finally {
      setRechecking(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/60 backdrop-blur-[2px] p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="org-setup-title"
    >
      <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-2xl w-full my-6 overflow-hidden">
        {/* Top Navy Header */}
        <div className="bg-[#1f2a44] text-white px-6 py-5 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <img
              src="/src/assets/images/ap_brothers_logo_1795689650195.jpg"
              alt="Workspace Logo"
              className="w-10 h-10 rounded-lg bg-white p-0.5 object-contain shrink-0"
            />
            <div>
              <h1 id="org-setup-title" className="text-base font-semibold">
                Organization Setup
              </h1>
              <p className="text-xs text-slate-300 mt-0.5">
                Signed in as {user?.email}. Create your inventory &amp; billing workspace to continue.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 hover:text-white bg-white/10 hover:bg-white/15 rounded-lg shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>

        {/* Stepper */}
        <div className="px-6 py-3.5 bg-slate-50 border-b border-slate-200 grid grid-cols-3 gap-2 text-xs">
          {[
            { num: 1 as const, label: 'Company Profile', icon: <Building2 className="w-3.5 h-3.5" /> },
            { num: 2 as const, label: 'Location & Tax', icon: <MapPin className="w-3.5 h-3.5" /> },
            { num: 3 as const, label: 'Warehouse & Catalog', icon: <WarehouseIcon className="w-3.5 h-3.5" /> },
          ].map((s) => {
            const active = step === s.num;
            const done = step > s.num;
            return (
              <button
                key={s.num}
                type="button"
                onClick={() => {
                  if (s.num < step || (s.num > 1 && name.trim())) setStep(s.num);
                }}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-colors ${
                  active
                    ? 'bg-white border-[#408dfb] text-[#1f2a44] font-semibold shadow-xs'
                    : done
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800 font-medium'
                      : 'bg-transparent border-transparent text-slate-500'
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] shrink-0 ${
                    active
                      ? 'bg-[#408dfb] text-white'
                      : done
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : s.num}
                </span>
                <span className="truncate">{s.label}</span>
              </button>
            );
          })}
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 text-xs">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3.5 py-2.5 text-xs">
              {error}
            </div>
          )}

          {step === 1 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label htmlFor="setup-org-name" className="block font-medium text-slate-700 mb-1">
                  Organization Display Name *
                </label>
                <input
                  id="setup-org-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. A & P Brothers (Pvt) Ltd"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-[#408dfb]"
                />
              </div>
              <div>
                <label htmlFor="setup-legal-name" className="block font-medium text-slate-700 mb-1">
                  Registered Legal Name
                </label>
                <input
                  id="setup-legal-name"
                  type="text"
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-[#408dfb]"
                />
              </div>
              <div>
                <label htmlFor="setup-currency" className="block font-medium text-slate-700 mb-1">
                  Base Currency
                </label>
                <select
                  id="setup-currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-[#408dfb]"
                >
                  <option value="LKR">LKR — Sri Lankan Rupee (Rs.)</option>
                  <option value="USD">USD — US Dollar</option>
                  <option value="INR">INR — Indian Rupee</option>
                  <option value="EUR">EUR — Euro</option>
                </select>
              </div>
              <div>
                <label htmlFor="setup-email" className="block font-medium text-slate-700 mb-1">
                  Business Email
                </label>
                <input
                  id="setup-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-[#408dfb]"
                />
              </div>
              <div>
                <label htmlFor="setup-phone" className="block font-medium text-slate-700 mb-1">
                  Phone Number
                </label>
                <input
                  id="setup-phone"
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-[#408dfb]"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label htmlFor="setup-address" className="block font-medium text-slate-700 mb-1">
                  Street Address
                </label>
                <input
                  id="setup-address"
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-[#408dfb]"
                />
              </div>
              <div>
                <label htmlFor="setup-city" className="block font-medium text-slate-700 mb-1">
                  City
                </label>
                <input
                  id="setup-city"
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-[#408dfb]"
                />
              </div>
              <div>
                <label htmlFor="setup-country" className="block font-medium text-slate-700 mb-1">
                  Country
                </label>
                <input
                  id="setup-country"
                  type="text"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-[#408dfb]"
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="setup-tax-id" className="block font-medium text-slate-700 mb-1">
                  VAT / Tax Registration Number
                </label>
                <input
                  id="setup-tax-id"
                  type="text"
                  value={taxId}
                  onChange={(e) => setTaxId(e.target.value)}
                  placeholder="Optional VAT or TIN number shown on invoices"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-[#408dfb]"
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="setup-wh-name" className="block font-medium text-slate-700 mb-1">
                    Primary Warehouse Name
                  </label>
                  <input
                    id="setup-wh-name"
                    type="text"
                    value={primaryWarehouseName}
                    onChange={(e) => setPrimaryWarehouseName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-[#408dfb]"
                  />
                </div>
                <div>
                  <label htmlFor="setup-wh-code" className="block font-medium text-slate-700 mb-1">
                    Warehouse Code
                  </label>
                  <input
                    id="setup-wh-code"
                    type="text"
                    value={primaryWarehouseCode}
                    onChange={(e) => setPrimaryWarehouseCode(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono-num focus:outline-none focus:border-[#408dfb]"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2.5 p-3 rounded-lg border border-slate-200 bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeShowroom}
                  onChange={(e) => setIncludeShowroom(e.target.checked)}
                  className="rounded border-slate-300 text-[#408dfb]"
                />
                <span>Also create a secondary &ldquo;Showroom&rdquo; warehouse (WH-SHOW) for stock transfers</span>
              </label>

              <div>
                <p className="font-medium text-slate-700 mb-2">Starting Product Catalog</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setLoadDemo(false)}
                    className={`p-3.5 rounded-xl border text-left transition-colors ${
                      !loadDemo
                        ? 'border-[#408dfb] bg-blue-50/50 ring-1 ring-[#408dfb]'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold text-slate-900">
                      <PackagePlus className="w-4 h-4 text-[#408dfb]" />
                      Start Clean (My Products)
                    </div>
                    <p className="text-[11px] text-slate-600 mt-1">
                      Empty catalog ready for adding your items one by one or uploading an Excel / CSV sheet.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setLoadDemo(true)}
                    className={`p-3.5 rounded-xl border text-left transition-colors ${
                      loadDemo
                        ? 'border-[#408dfb] bg-blue-50/50 ring-1 ring-[#408dfb]'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold text-slate-900">
                      <Sparkles className="w-4 h-4 text-[#408dfb]" />
                      Pre-load Demo Catalog
                    </div>
                    <p className="text-[11px] text-slate-600 mt-1">
                      Includes 40 motorcycle spare parts and sample invoices/orders (you can clear demo items anytime).
                    </p>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Footer Controls */}
          <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              disabled={rechecking || submitting}
              onClick={handleRecheckInvites}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${rechecking ? 'animate-spin' : ''}`} />
              {rechecking ? 'Checking invites...' : 'Invited to an existing team? Check invites'}
            </button>

            <div className="flex items-center gap-2">
              {step > 1 && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-50"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back
                </button>
              )}

              {step < 3 ? (
                <button
                  type="button"
                  onClick={handleNext}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#408dfb] hover:bg-[#2f7ae5] text-white rounded-lg font-medium"
                >
                  Next Step
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 px-5 py-2 bg-[#408dfb] hover:bg-[#2f7ae5] text-white rounded-lg font-semibold disabled:opacity-60"
                >
                  {submitting ? 'Creating Workspace...' : 'Create Workspace'}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
