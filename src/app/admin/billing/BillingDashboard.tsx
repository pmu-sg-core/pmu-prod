'use client';

import { useState } from 'react';

export interface LeadEntry {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  source: string;
  bca_grade: string | null;
  outreach_status: string;
  created_at: string;
}

export interface SubscriberBilling {
  id: string;
  email: string;
  name: string;
  plan_type: string;
  status_label: string | null;
  external_subscription_id: string | null;
  external_customer_id: string | null;
  tasks_used: number;
  tasks_cap: number;       // -1 = unlimited
  renewal_date: string | null;
  renewal_amount_sgd: number;
  days_until_exhaustion: number | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function planBadgeColor(plan: string) {
  return plan === 'corporate' ? 'text-purple-400 bg-purple-500/10'
       : plan === 'pro'       ? 'text-blue-400 bg-blue-500/10'
       : plan === 'lite'      ? 'text-[#00d4a1] bg-[#00d4a1]/10'
       :                        'text-zinc-400 bg-zinc-800';
}

function statusColor(label: string | null) {
  return label === 'Active'    ? 'text-[#00d4a1] bg-[#00d4a1]/10'
       : label === 'Trialing'  ? 'text-blue-400 bg-blue-500/10'
       : label === 'Suspended' ? 'text-yellow-400 bg-yellow-500/10'
       : label === 'Cancelled' ? 'text-red-400 bg-red-500/10'
       :                         'text-zinc-400 bg-zinc-800';
}

// ── Resource Health Card ───────────────────────────────────────────────────────

function ResourceHealthCard({ sub, onPortal, loading }: {
  sub: SubscriberBilling;
  onPortal: (id: string) => void;
  loading: boolean;
}) {
  return (
    <div className="bg-[#1a1a1a] border border-zinc-800 rounded-2xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-white font-semibold">{sub.name}</div>
          <div className="text-zinc-500 text-xs mt-0.5">{sub.email}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs px-2 py-1 rounded font-medium ${planBadgeColor(sub.plan_type)}`}>
            {sub.plan_type.charAt(0).toUpperCase() + sub.plan_type.slice(1)}
          </span>
          <span className={`text-xs px-2 py-1 rounded font-medium ${statusColor(sub.status_label)}`}>
            {sub.status_label ?? 'No status'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 pt-1">
        <div className="bg-[#0d0d0d] rounded-xl p-3">
          <div className="text-xs text-zinc-500 mb-1">Next Renewal</div>
          <div className="text-white font-semibold text-sm">{formatDate(sub.renewal_date)}</div>
        </div>
        <div className="bg-[#0d0d0d] rounded-xl p-3">
          <div className="text-xs text-zinc-500 mb-1">Renewal Total</div>
          <div className="text-white font-semibold text-sm">
            {sub.renewal_amount_sgd === 0 ? 'Free' : `S$${sub.renewal_amount_sgd.toLocaleString()}`}
          </div>
        </div>
      </div>

      {sub.external_customer_id && (
        <button
          onClick={() => onPortal(sub.id)}
          disabled={loading}
          className="w-full text-sm border border-zinc-700 hover:border-[#00d4a1] text-zinc-400 hover:text-[#00d4a1] py-2 rounded-lg transition-colors disabled:opacity-40"
        >
          Manage in Stripe →
        </button>
      )}
    </div>
  );
}

// ── Credits Gauge ──────────────────────────────────────────────────────────────

function CreditsGauge({ sub }: { sub: SubscriberBilling }) {
  const unlimited = sub.tasks_cap === -1;
  const pct = unlimited ? 0 : Math.min(100, Math.round((sub.tasks_used / sub.tasks_cap) * 100));
  const critical = pct >= 85;
  const warning  = pct >= 60 && pct < 85;

  const barColor = critical ? 'bg-red-500' : warning ? 'bg-yellow-400' : 'bg-[#00d4a1]';

  return (
    <div className="bg-[#1a1a1a] border border-zinc-800 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Task Credits</div>
        {unlimited
          ? <span className="text-xs text-purple-400 bg-purple-500/10 px-2 py-1 rounded">Unlimited</span>
          : <span className="text-xs text-zinc-500 font-mono">{sub.tasks_used} / {sub.tasks_cap}</span>
        }
      </div>

      {!unlimited && (
        <>
          <div className="space-y-1.5">
            <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
            </div>
            <div className="flex justify-between text-xs text-zinc-600">
              <span>{pct}% used</span>
              <span>{sub.tasks_cap - sub.tasks_used} remaining</span>
            </div>
          </div>

          <div className={`rounded-xl p-3 ${critical ? 'bg-red-500/10 border border-red-500/20' : warning ? 'bg-yellow-500/10 border border-yellow-500/20' : 'bg-[#0d0d0d]'}`}>
            <div className={`text-xs font-medium ${critical ? 'text-red-400' : warning ? 'text-yellow-400' : 'text-zinc-400'}`}>
              Projected velocity
            </div>
            <div className="text-white text-sm mt-1">
              {sub.days_until_exhaustion === null
                ? 'No usage this month'
                : sub.days_until_exhaustion <= 0
                ? 'Limit reached — upgrade to continue'
                : `Credits exhaust in ~${sub.days_until_exhaustion} day${sub.days_until_exhaustion === 1 ? '' : 's'}`
              }
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Grant Export ───────────────────────────────────────────────────────────────

function GrantExportCard({ sub, onExport, loading }: {
  sub: SubscriberBilling;
  onExport: (id: string) => void;
  loading: boolean;
}) {
  return (
    <div className="bg-[#1a1a1a] border border-zinc-800 rounded-2xl p-5 space-y-4">
      <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Audit & Grant Reporting</div>

      <div className="space-y-2">
        <div className="flex items-start gap-3 bg-[#0d0d0d] rounded-xl p-3">
          <div className="w-1.5 h-1.5 rounded-full bg-[#00d4a1] mt-1.5 shrink-0" />
          <div>
            <div className="text-white text-xs font-medium">MAS / IMDA Audit Ready</div>
            <div className="text-zinc-500 text-xs mt-0.5">All workflows cryptographically signed via hash-chain audit trail</div>
          </div>
        </div>
        <div className="flex items-start gap-3 bg-[#0d0d0d] rounded-xl p-3">
          <div className="w-1.5 h-1.5 rounded-full bg-[#00d4a1] mt-1.5 shrink-0" />
          <div>
            <div className="text-white text-xs font-medium">WSG / EnterpriseSG (JR+)</div>
            <div className="text-zinc-500 text-xs mt-0.5">Export task logs for Job Redesign Grant claims (70–90% funding)</div>
          </div>
        </div>
      </div>

      <button
        onClick={() => onExport(sub.id)}
        disabled={loading}
        className="w-full bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        Download WSG / EnterpriseSG Audit Report
      </button>
    </div>
  );
}

// ── Generate Link Panel ────────────────────────────────────────────────────────

function GenerateLinkPanel({ subscribers }: { subscribers: SubscriberBilling[] }) {
  const [selectedId, setSelectedId] = useState('');
  const [plan, setPlan] = useState('lite');
  const [loading, setLoading] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = subscribers.find(s => s.id === selectedId);

  async function handleGenerate() {
    if (!selectedId || !selected) return;
    setLoading(true); setCheckoutUrl(null); setError(null);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptionId: selectedId, plan, email: selected.email, name: selected.name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Unknown error');
      setCheckoutUrl(data.url);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }

  const inputClass = "w-full bg-[#0d0d0d] border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00d4a1] transition-colors";

  return (
    <div className="bg-[#1a1a1a] border border-zinc-800 rounded-2xl p-6 space-y-4">
      <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Generate Checkout Link</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Subscriber</label>
          <select value={selectedId} onChange={e => setSelectedId(e.target.value)} className={inputClass}>
            <option value="">— Select subscriber —</option>
            {subscribers.map(s => (
              <option key={s.id} value={s.id}>{s.name} ({s.email})</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Plan</label>
          <select value={plan} onChange={e => setPlan(e.target.value)} className={inputClass}>
            <option value="lite">Lite — S$149/mo</option>
            <option value="pro">Pro — S$449/mo</option>
          </select>
        </div>
      </div>

      <button
        onClick={handleGenerate}
        disabled={!selectedId || loading}
        className="bg-[#00d4a1] hover:bg-[#00bfa0] disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold py-2.5 px-6 rounded-lg transition-colors text-sm"
      >
        {loading ? 'Generating...' : 'Generate Link'}
      </button>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {checkoutUrl && (
        <div className="space-y-2">
          <p className="text-xs text-zinc-400 uppercase tracking-wider font-semibold">Copy and send to subscriber</p>
          <div className="flex items-center gap-2">
            <input readOnly value={checkoutUrl} className={`${inputClass} font-mono text-xs`} onClick={e => (e.target as HTMLInputElement).select()} />
            <button
              onClick={() => navigator.clipboard.writeText(checkoutUrl)}
              className="shrink-0 border border-zinc-700 hover:border-zinc-500 text-zinc-400 hover:text-white text-xs px-3 py-2 rounded-lg transition-colors"
            >
              Copy
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Leads Table ────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  new:          'text-zinc-400 bg-zinc-800',
  contacted:    'text-blue-400 bg-blue-500/10',
  replied:      'text-yellow-400 bg-yellow-500/10',
  demo_booked:  'text-purple-400 bg-purple-500/10',
  converted:    'text-[#00d4a1] bg-[#00d4a1]/10',
  disqualified: 'text-red-400 bg-red-500/10',
};

function LeadsTable({ leads }: { leads: LeadEntry[] }) {
  return (
    <div className="bg-[#1a1a1a] border border-zinc-800 rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-zinc-800">
        <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Outreach Leads</h2>
        <p className="text-xs text-zinc-500 mt-0.5">BCA contractor targets from direct outreach</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Company / Contact</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">BCA Grade</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Source</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Status</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Added</th>
            </tr>
          </thead>
          <tbody>
            {leads.map(lead => (
              <tr key={lead.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/20 transition-colors">
                <td className="px-6 py-4">
                  <div className="text-white font-medium">{lead.company ?? '—'}</div>
                  <div className="text-zinc-500 text-xs">{[lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email}</div>
                  <div className="text-zinc-600 text-xs">{lead.email}</div>
                </td>
                <td className="px-6 py-4">
                  {lead.bca_grade
                    ? <span className="text-xs font-mono font-semibold text-[#00d4a1]">{lead.bca_grade}</span>
                    : <span className="text-zinc-600 text-xs">—</span>
                  }
                </td>
                <td className="px-6 py-4 text-xs text-zinc-400">{lead.source}</td>
                <td className="px-6 py-4">
                  <span className={`text-xs px-2 py-1 rounded font-medium ${STATUS_COLORS[lead.outreach_status] ?? 'text-zinc-400 bg-zinc-800'}`}>
                    {lead.outreach_status}
                  </span>
                </td>
                <td className="px-6 py-4 text-xs text-zinc-500">
                  {new Date(lead.created_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}
                </td>
              </tr>
            ))}
            {leads.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-zinc-600 text-sm">No outreach leads yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Root component ─────────────────────────────────────────────────────────────

export function BillingDashboard({ subscribers, leads }: { subscribers: SubscriberBilling[]; leads: LeadEntry[] }) {
  const [tab, setTab] = useState<'subscriptions' | 'leads'>('subscriptions');
  const [portalLoading, setPortalLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePortal(subscriptionId: string) {
    setPortalLoading(true); setError(null);
    try {
      const res = await fetch('/api/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Unknown error');
      window.open(data.url, '_blank');
    } catch (e: any) { setError(e.message); }
    finally { setPortalLoading(false); }
  }

  async function handleExport(subscriptionId: string) {
    setExportLoading(true); setError(null);
    try {
      const res = await fetch(`/api/billing/export?subscriptionId=${subscriptionId}`);
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pmu-sg-audit-${subscriptionId.slice(0, 8)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) { setError(e.message); }
    finally { setExportLoading(false); }
  }

  const activeSubscribers = subscribers.filter(s => s.status_label === 'Active' || s.status_label === 'Trialing');
  const allSubscribers = subscribers;

  const tabClass = (t: typeof tab) =>
    `text-sm px-4 py-2 rounded-lg transition-colors ${tab === t ? 'text-white bg-zinc-800 border border-zinc-700' : 'text-zinc-500 hover:text-white'}`;

  return (
    <div className="space-y-8">
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">{error}</div>
      )}

      {/* Tab switcher */}
      <div className="flex items-center gap-2">
        <button className={tabClass('subscriptions')} onClick={() => setTab('subscriptions')}>
          Subscriptions
          <span className="ml-2 text-xs text-zinc-500">({allSubscribers.length})</span>
        </button>
        <button className={tabClass('leads')} onClick={() => setTab('leads')}>
          Leads
          <span className="ml-2 text-xs text-zinc-500">({leads.length})</span>
        </button>
      </div>

      {tab === 'leads' && <LeadsTable leads={leads} />}

      {tab === 'subscriptions' && <>
      {/* Active subscriber cards */}
      {activeSubscribers.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4">Active Subscriptions</h2>
          <div className="space-y-6">
            {activeSubscribers.map(sub => (
              <div key={sub.id} className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <ResourceHealthCard sub={sub} onPortal={handlePortal} loading={portalLoading} />
                <CreditsGauge sub={sub} />
                <GrantExportCard sub={sub} onExport={handleExport} loading={exportLoading} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Generate checkout link */}
      <GenerateLinkPanel subscribers={allSubscribers} />

      {/* All subscribers table */}
      <div className="bg-[#1a1a1a] border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">All Subscribers</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Subscriber</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Plan</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Tasks</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Renewal</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Stripe Sub</th>
              </tr>
            </thead>
            <tbody>
              {allSubscribers.map(s => (
                <tr key={s.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/20 transition-colors">
                  <td className="px-6 py-4">
                    <div className="text-white font-medium">{s.name}</div>
                    <div className="text-zinc-500 text-xs">{s.email}</div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-xs px-2 py-1 rounded font-medium ${planBadgeColor(s.plan_type)}`}>
                      {s.plan_type}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-xs px-2 py-1 rounded font-medium ${statusColor(s.status_label)}`}>
                      {s.status_label ?? '—'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {s.tasks_cap === -1
                      ? <span className="text-zinc-500 text-xs">unlimited</span>
                      : <span className="text-xs text-zinc-300 font-mono">{s.tasks_used} / {s.tasks_cap}</span>
                    }
                  </td>
                  <td className="px-6 py-4 text-xs text-zinc-400">{formatDate(s.renewal_date)}</td>
                  <td className="px-6 py-4 text-xs text-zinc-600 font-mono">
                    {s.external_subscription_id ? s.external_subscription_id.slice(0, 18) + '…' : '—'}
                  </td>
                </tr>
              ))}
              {allSubscribers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-zinc-600 text-sm">No subscribers yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>}
    </div>
  );
}
