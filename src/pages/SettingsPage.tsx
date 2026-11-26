import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Building2,
  Database,
  Download,
  Eraser,
  FileCode2,
  Percent,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';
import { useOrg } from '../hooks/useOrg';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { OrgInvite, OrgMember, TaxRate, UserRole } from '../types';
import {
  fetchOrgInvites,
  fetchOrgMembers,
  inviteOrgMember,
  revokeOrgInvite,
  updateMemberRole,
  updateOrganizationProfile,
} from '../services/orgService';
import {
  createTaxRate,
  exportOrganizationJsonBackup,
  fetchTaxes,
  saveOrgSettings,
} from '../services/settingsService';
import { softDeleteOrgDoc } from '../services/firestoreList';
import { uploadFileToStorage } from '../services/documentsService';
import { recalculateStockFromLedger } from '../services/stockService';
import { clearAllDemoData, clearDemoItems, seedDemoData } from '../services/seedService';
import { StatusBadge } from '../components/StatusBadge';
import { ConfirmDialog } from '../components/ConfirmDialog';

type SettingsTab = 'profile' | 'users' | 'taxes' | 'numbering' | 'templates' | 'data';

const VALID_TABS: SettingsTab[] = ['profile', 'users', 'taxes', 'numbering', 'templates', 'data'];
const ROLES: UserRole[] = ['Admin', 'Manager', 'Sales', 'Warehouse', 'Accountant', 'Read-only'];

export function SettingsPage() {
  const { orgId, org, settings, refreshOrg, can } = useOrg();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const paramTab = searchParams.get('tab') as SettingsTab | null;
  const initialTab: SettingsTab = paramTab && VALID_TABS.includes(paramTab) ? paramTab : 'profile';
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [taxes, setTaxes] = useState<TaxRate[]>([]);

  const [orgName, setOrgName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [taxId, setTaxId] = useState('');
  const [logoUrl, setLogoUrl] = useState('');

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('Sales');

  const [newTaxName, setNewTaxName] = useState('');
  const [newTaxRate, setNewTaxRate] = useState('18');

  const [unitsText, setUnitsText] = useState('PCS, SET, BOX, PAIR');
  const [prefixes, setPrefixes] = useState<Record<string, string>>({});
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [pdfTerms, setPdfTerms] = useState('');
  const [pdfFooter, setPdfFooter] = useState('');
  const [lowStockAlerts, setLowStockAlerts] = useState(true);
  const [dailyDigest, setDailyDigest] = useState(false);

  const [busy, setBusy] = useState(false);
  const [seedingDemo, setSeedingDemo] = useState(false);
  const [clearTarget, setClearTarget] = useState<'demoItems' | 'allData' | null>(null);

  useEffect(() => {
    const next = searchParams.get('tab') as SettingsTab | null;
    if (next && VALID_TABS.includes(next)) {
      setTab(next);
    }
  }, [searchParams]);

  const handleTabChange = (nextTab: SettingsTab) => {
    setTab(nextTab);
    setSearchParams({ tab: nextTab }, { replace: true });
  };

  const loadSubData = useCallback(async () => {
    if (!orgId) return;
    const [m, inv, tx] = await Promise.all([
      fetchOrgMembers(orgId),
      fetchOrgInvites(orgId),
      fetchTaxes(orgId),
    ]);
    setMembers(m);
    setInvites(inv);
    setTaxes(tx);
  }, [orgId]);

  useEffect(() => {
    if (org) {
      setOrgName(org.name || '');
      setAddress(org.address || '');
      setCity(org.city || '');
      setPhone(org.phone || '');
      setEmail(org.email || '');
      setTaxId(org.taxId || '');
      setLogoUrl(org.logoUrl || '');
    }
    if (settings) {
      setUnitsText((settings.units || ['PCS', 'SET', 'BOX', 'PAIR']).join(', '));
      setPrefixes(settings.prefixes || {});
      setEmailSubject(settings.emailTemplateSubject || '');
      setEmailBody(settings.emailTemplateBody || '');
      setPdfTerms(settings.pdfTermsAndConditions || '');
      setPdfFooter(settings.pdfFooterNote || '');
      setLowStockAlerts(Boolean(settings.lowStockAlertsEnabled));
      setDailyDigest(Boolean(settings.dailyDigestEnabled));
    }
    void loadSubData();
  }, [org, settings, loadSubData]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !user) return;
    setBusy(true);
    try {
      await updateOrganizationProfile(orgId, user.uid, {
        name: orgName.trim(),
        address: address.trim(),
        city: city.trim(),
        phone: phone.trim(),
        email: email.trim(),
        taxId: taxId.trim(),
        logoUrl: logoUrl.trim(),
      });
      await refreshOrg();
      showToast('Organization profile saved', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !orgId || !user) return;
    setBusy(true);
    try {
      const { url } = await uploadFileToStorage(orgId, 'branding', file);
      setLogoUrl(url);
      await updateOrganizationProfile(orgId, user.uid, { logoUrl: url });
      await refreshOrg();
      showToast('Organization logo updated', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Logo upload failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !org || !user || !inviteEmail.trim()) return;
    setBusy(true);
    try {
      await inviteOrgMember({
        orgId,
        orgName: org.name,
        email: inviteEmail.trim(),
        role: inviteRole,
        invitedByUid: user.uid,
        invitedByName: user.displayName || user.email || 'Admin',
      });
      setInviteEmail('');
      await loadSubData();
      showToast('Invitation created. The user joins automatically when they sign up with a verified email.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Invite failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleAddTax = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !user || !newTaxName.trim()) return;
    setBusy(true);
    try {
      await createTaxRate(orgId, user.uid, {
        name: newTaxName.trim(),
        rate: Number(newTaxRate) || 0,
        type: 'standard',
        isDefault: false,
        status: 'active',
      });
      setNewTaxName('');
      await loadSubData();
      showToast('Tax rate added', 'success');
    } finally {
      setBusy(false);
    }
  };

  const handleSavePrefs = async () => {
    if (!orgId || !user) return;
    setBusy(true);
    try {
      await saveOrgSettings(orgId, user.uid, user.displayName || user.email || 'Admin', {
        units: unitsText.split(',').map((u) => u.trim()).filter(Boolean),
        prefixes,
        emailTemplateSubject: emailSubject,
        emailTemplateBody: emailBody,
        pdfTermsAndConditions: pdfTerms,
        pdfFooterNote: pdfFooter,
        lowStockAlertsEnabled: lowStockAlerts,
        dailyDigestEnabled: dailyDigest,
      });
      await refreshOrg();
      showToast('Settings saved', 'success');
    } finally {
      setBusy(false);
    }
  };

  const handleRecalculateStock = async () => {
    if (!orgId || !user) return;
    setBusy(true);
    try {
      const res = await recalculateStockFromLedger(
        orgId,
        user.uid,
        user.displayName || user.email || 'Admin'
      );
      showToast(
        `Reconciled ${res.updatedItems} item(s) across ${res.ledgerEntriesScanned} ledger entries`,
        'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Reconciliation failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleExportJsonBackup = async () => {
    if (!orgId) return;
    setBusy(true);
    try {
      const backup = await exportOrganizationJsonBackup(orgId);
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ap-brothers-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('JSON backup downloaded', 'success');
    } finally {
      setBusy(false);
    }
  };

  const handleLoadDemoData = async () => {
    if (!orgId || !user) return;
    setSeedingDemo(true);
    try {
      const res = await seedDemoData(orgId, user.uid, user.displayName || user.email || 'Admin');
      if (res.alreadyLoaded) {
        showToast(
          'Demo motorcycle parts, warehouses, and vendors are already loaded in this organization.',
          'info'
        );
      } else {
        showToast(
          `Loaded ${res.items} motorcycle parts, ${res.warehouses} warehouse(s), ${res.vendors} vendors, ${res.customers} customers & ${res.orders} orders`,
          'success'
        );
      }
      await refreshOrg();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Demo seed failed', 'error');
    } finally {
      setSeedingDemo(false);
    }
  };

  const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: 'profile', label: 'Organization Profile', icon: <Building2 className="w-4 h-4" /> },
    { id: 'users', label: 'Users, Roles & Invites', icon: <Users className="w-4 h-4" /> },
    { id: 'taxes', label: 'Taxes & VAT', icon: <Percent className="w-4 h-4" /> },
    { id: 'numbering', label: 'Units & Prefixes', icon: <FileCode2 className="w-4 h-4" /> },
    { id: 'templates', label: 'Templates & Alerts', icon: <ShieldCheck className="w-4 h-4" /> },
    { id: 'data', label: 'Data, Ledger & Demo', icon: <Database className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Organization Settings</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Admin control center for company profile, RBAC permissions, tax rates, templates, and stock ledger integrity
          </p>
        </div>
        {can('settings', 'edit') && (
          <button
            type="button"
            disabled={busy || seedingDemo}
            onClick={handleLoadDemoData}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#408dfb] text-white rounded-lg text-xs font-medium hover:bg-[#2f7ae5] disabled:opacity-60 self-start sm:self-auto"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {seedingDemo ? 'Loading Demo Data...' : 'Load Demo Data'}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        <div className="bg-white border border-slate-200 rounded-lg p-3 h-fit space-y-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => handleTabChange(t.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs ${
                tab === t.id
                  ? 'bg-[#408dfb] text-white font-semibold'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        <div className="lg:col-span-3 bg-white border border-slate-200 rounded-lg p-6">
          {tab === 'profile' && (
            <form onSubmit={handleSaveProfile} className="space-y-4 text-xs max-w-2xl">
              <div className="flex items-center gap-4 pb-4 border-b border-slate-200">
                <img
                  src={logoUrl || '/src/assets/images/ap_brothers_logo_1795689650195.jpg'}
                  alt="Company logo"
                  referrerPolicy="no-referrer"
                  className="w-16 h-16 rounded-lg object-cover border border-slate-200"
                />
                <div>
                  <p className="font-semibold text-slate-900">Company Logo</p>
                  <label className="mt-1.5 inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50">
                    <Upload className="w-3.5 h-3.5" />
                    Upload New Logo
                    <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Organization Name *</label>
                  <input type="text" required value={orgName} onChange={(e) => setOrgName(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">VAT / Tax Registration ID</label>
                  <input type="text" value={taxId} onChange={(e) => setTaxId(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Email</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Phone</label>
                  <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Street Address</label>
                  <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">City</label>
                  <input type="text" value={city} onChange={(e) => setCity(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                </div>
              </div>

              <button type="submit" disabled={busy} className="px-4 py-2 bg-[#408dfb] text-white rounded-lg font-medium">
                {busy ? 'Saving...' : 'Save Organization Profile'}
              </button>
            </form>
          )}

          {tab === 'users' && (
            <div className="space-y-6 text-xs">
              <form onSubmit={handleInvite} className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
                <p className="font-semibold text-slate-900 flex items-center gap-1.5">
                  <UserPlus className="w-4 h-4 text-[#408dfb]" /> Invite User by Email
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="colleague@apbrothers.lk"
                    className="flex-1 px-3 py-2 bg-white border border-slate-300 rounded-lg"
                  />
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as UserRole)}
                    className="px-3 py-2 bg-white border border-slate-300 rounded-lg"
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <button type="submit" disabled={busy} className="px-4 py-2 bg-[#408dfb] text-white rounded-lg font-medium whitespace-nowrap">
                    Send Invite
                  </button>
                </div>
                <p className="text-[11px] text-slate-500">
                  Invited users automatically join this organization with the assigned role upon signing in with a verified email address.
                </p>
              </form>

              <div>
                <h3 className="font-semibold text-slate-900 mb-2">Active Members ({members.length})</h3>
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="text-left px-3 py-2">User</th>
                        <th className="text-left px-3 py-2">Email</th>
                        <th className="text-left px-3 py-2">Role</th>
                        <th className="text-left px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {members.map((m) => (
                        <tr key={m.id}>
                          <td className="px-3 py-2 font-medium text-slate-900">{m.displayName}</td>
                          <td className="px-3 py-2 text-slate-600">{m.email}</td>
                          <td className="px-3 py-2">
                            <select
                              value={m.role}
                              disabled={m.uid === user?.uid}
                              onChange={async (e) => {
                                if (!orgId || !user) return;
                                await updateMemberRole(orgId, m.uid, e.target.value as UserRole, m.status, user.uid);
                                await loadSubData();
                                showToast('Role updated', 'success');
                              }}
                              className="px-2 py-1 border border-slate-300 rounded bg-white disabled:bg-slate-100"
                            >
                              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2"><StatusBadge status={m.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {invites.length > 0 && (
                <div>
                  <h3 className="font-semibold text-slate-900 mb-2">Invitations ({invites.length})</h3>
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <tr>
                          <th className="text-left px-3 py-2">Email</th>
                          <th className="text-left px-3 py-2">Role</th>
                          <th className="text-left px-3 py-2">Status</th>
                          <th className="text-right px-3 py-2">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {invites.map((inv) => (
                          <tr key={inv.id}>
                            <td className="px-3 py-2">{inv.email}</td>
                            <td className="px-3 py-2">{inv.role}</td>
                            <td className="px-3 py-2"><StatusBadge status={inv.status} /></td>
                            <td className="px-3 py-2 text-right">
                              {inv.status === 'pending' && (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    if (!orgId || !user) return;
                                    await revokeOrgInvite(orgId, inv.id, user.uid);
                                    await loadSubData();
                                    showToast('Invite revoked', 'info');
                                  }}
                                  className="text-red-600 hover:underline"
                                >
                                  Revoke
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'taxes' && (
            <div className="space-y-4 text-xs max-w-xl">
              <form onSubmit={handleAddTax} className="flex gap-2">
                <input
                  type="text"
                  required
                  value={newTaxName}
                  onChange={(e) => setNewTaxName(e.target.value)}
                  placeholder="Tax Name (e.g. SSCL 2.5%)"
                  className="flex-1 px-3 py-2 border border-slate-300 rounded-lg"
                />
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={newTaxRate}
                  onChange={(e) => setNewTaxRate(e.target.value)}
                  className="w-24 px-3 py-2 border border-slate-300 rounded-lg tabular-nums"
                />
                <button type="submit" disabled={busy} className="px-4 py-2 bg-[#408dfb] text-white rounded-lg font-medium">
                  Add Tax
                </button>
              </form>

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-3 py-2">Tax Name</th>
                      <th className="text-right px-3 py-2">Rate %</th>
                      <th className="text-right px-3 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {taxes.map((t) => (
                      <tr key={t.id}>
                        <td className="px-3 py-2 font-medium">{t.name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{t.rate}%</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={async () => {
                              if (!orgId || !user) return;
                              await softDeleteOrgDoc(orgId, 'taxes', t.id, user.uid);
                              await loadSubData();
                              showToast('Tax removed', 'success');
                            }}
                            className="text-red-600 hover:underline"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'numbering' && (
            <div className="space-y-4 text-xs max-w-2xl">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Inventory Units (comma-separated)</label>
                <input
                  type="text"
                  value={unitsText}
                  onChange={(e) => setUnitsText(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {Object.entries(prefixes).map(([k, v]) => (
                  <div key={k}>
                    <label className="block font-medium text-slate-600 mb-1 capitalize">{k}</label>
                    <input
                      type="text"
                      value={v}
                      onChange={(e) => setPrefixes({ ...prefixes, [k]: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono-num"
                    />
                  </div>
                ))}
              </div>
              <button type="button" disabled={busy} onClick={handleSavePrefs} className="px-4 py-2 bg-[#408dfb] text-white rounded-lg font-medium">
                Save Units &amp; Prefixes
              </button>
            </div>
          )}

          {tab === 'templates' && (
            <div className="space-y-4 text-xs max-w-2xl">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Email Template Subject</label>
                <input type="text" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Email Template Body</label>
                <textarea rows={4} value={emailBody} onChange={(e) => setEmailBody(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">PDF Terms &amp; Conditions</label>
                <textarea rows={3} value={pdfTerms} onChange={(e) => setPdfTerms(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">PDF Footer Note</label>
                <input type="text" value={pdfFooter} onChange={(e) => setPdfFooter(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
              </div>
              <div className="space-y-2 pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={lowStockAlerts} onChange={(e) => setLowStockAlerts(e.target.checked)} className="rounded border-slate-300 text-[#408dfb]" />
                  <span>Enable real-time low-stock notifications when stock drops below reorder level</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={dailyDigest} onChange={(e) => setDailyDigest(e.target.checked)} className="rounded border-slate-300 text-[#408dfb]" />
                  <span>Enable daily summary digest flag</span>
                </label>
              </div>
              <button type="button" disabled={busy} onClick={handleSavePrefs} className="px-4 py-2 bg-[#408dfb] text-white rounded-lg font-medium">
                Save Templates &amp; Preferences
              </button>
            </div>
          )}

          {tab === 'data' && (
            <div className="space-y-5 text-xs max-w-2xl">
              <div className="border border-slate-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-slate-900">Recalculate Stock from Ledger</h3>
                  <p className="text-slate-500 mt-0.5">
                    Scans the append-only stockLedger and reconciles every item&apos;s warehouse stock on hand.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleRecalculateStock}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#1f2a44] text-white rounded-lg font-medium shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Recalculate Stock
                </button>
              </div>

              <div className="border border-slate-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-slate-900">Export Organization Backup (JSON)</h3>
                  <p className="text-slate-500 mt-0.5">
                    Downloads a complete snapshot of items, warehouses, ledgers, invoices, bills, and settings.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleExportJsonBackup}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-slate-300 bg-white rounded-lg font-medium hover:bg-slate-50 shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download JSON
                </button>
              </div>

              <div className="border border-blue-200 bg-blue-50/50 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-slate-900 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-[#408dfb]" /> Load Demo Data (Admin Only)
                  </h3>
                  <p className="text-slate-600 mt-0.5">
                    Populates 40 motorcycle spare parts (YYPP005, YYPP001, YYP002, YYIC002, etc.), 2 warehouses (Main Store &amp; Showroom), 6 sample Sri Lankan vendors, 10 customers, and 90 days of sales &amp; purchase workflows without duplicating existing SKUs.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy || seedingDemo}
                  onClick={handleLoadDemoData}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#408dfb] text-white rounded-lg font-medium shrink-0 hover:bg-[#2f7ae5] disabled:opacity-60"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {seedingDemo ? 'Loading...' : 'Load Demo Data'}
                </button>
              </div>

              <div className="border border-amber-200 bg-amber-50/60 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-slate-900 flex items-center gap-1.5">
                    <Eraser className="w-4 h-4 text-amber-700" /> Clear Demo Items
                  </h3>
                  <p className="text-slate-600 mt-0.5">
                    Removes the pre-loaded demo spare-part items and their low-stock alerts so you can add your own products one by one or via Excel upload.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setClearTarget('demoItems')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-amber-300 text-amber-800 rounded-lg font-medium shrink-0 hover:bg-amber-100"
                >
                  <Eraser className="w-3.5 h-3.5" />
                  Clear Demo Items
                </button>
              </div>

              <div className="border border-red-200 bg-red-50/50 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-slate-900 flex items-center gap-1.5">
                    <Trash2 className="w-4 h-4 text-red-600" /> Reset Workspace Catalog &amp; Transactions
                  </h3>
                  <p className="text-slate-600 mt-0.5">
                    Clears all items, customers, vendors, orders, invoices, and bills so you can start completely fresh with your own business records.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setClearTarget('allData')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-red-600 text-white rounded-lg font-medium shrink-0 hover:bg-red-700"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear All Data
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(clearTarget)}
        title={clearTarget === 'demoItems' ? 'Clear Demo Items' : 'Clear All Catalog & Transaction Data'}
        message={
          clearTarget === 'demoItems'
            ? 'Remove all pre-loaded demo spare parts and their low-stock notifications? Any custom items you created will be kept.'
            : 'Clear all items, customers, vendors, orders, invoices, and bills in this organization? Historical audit logs and stock ledger entries remain preserved.'
        }
        confirmLabel={clearTarget === 'demoItems' ? 'Clear Demo Items' : 'Clear All Data'}
        danger
        loading={busy}
        onCancel={() => setClearTarget(null)}
        onConfirm={async () => {
          if (!orgId || !user || !clearTarget) return;
          setBusy(true);
          try {
            const actorName = user.displayName || user.email || 'Admin';
            if (clearTarget === 'demoItems') {
              const res = await clearDemoItems(orgId, user.uid, actorName, 'demo');
              showToast(`Cleared ${res.clearedItems} demo item(s)`, 'success');
            } else {
              const res = await clearAllDemoData(orgId, user.uid, actorName);
              showToast(`Cleared ${res.clearedRecords} workspace record(s)`, 'success');
            }
            setClearTarget(null);
            await refreshOrg();
          } catch (err) {
            showToast(err instanceof Error ? err.message : 'Clear operation failed', 'error');
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}
