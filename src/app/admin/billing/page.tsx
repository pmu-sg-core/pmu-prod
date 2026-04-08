import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { logoutAdmin } from '../login/actions';
import { BillingDashboard, type LeadEntry } from './BillingDashboard';

// Plan monthly caps (mirrors plan_entitlements max_workitems_per_month)
const PLAN_TASK_CAPS: Record<string, number> = {
  pilot:     10,
  lite:      50,
  pro:       200,
  corporate: -1,
};

// Plan pricing in SGD
const PLAN_PRICES_SGD: Record<string, number> = {
  pilot:     0,
  lite:      149,
  pro:       449,
  corporate: 1299,
};

export default async function AdminBillingPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_session')?.value;
  if (!token) redirect('/admin/login');

  const authClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: { user } } = await authClient.auth.getUser(token);
  if (!user) redirect('/admin/login');

  const { data: roleData } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .single();
  if (roleData?.role !== 'admin') redirect('/admin/login');

  // Fetch outreach leads (waitlist entries from direct outreach sources)
  const { data: leadsRows } = await supabase
    .from('waitlist')
    .select('id, email, first_name, last_name, company, source, bca_grade, outreach_status, created_at')
    .in('source', ['bca_outreach', 'linkedin'])
    .order('created_at', { ascending: false });

  const leads: LeadEntry[] = (leadsRows ?? []) as LeadEntry[];

  // Fetch subscriptions with all billing fields
  const { data: rows } = await supabase
    .from('subscriptions')
    .select(`
      id,
      plan_type,
      tasks_created_this_month,
      current_period_end,
      external_customer_id,
      external_subscription_id,
      system_status ( label ),
      waitlist ( email, first_name, last_name ),
      subscriber:subscriber_id ( display_name, email )
    `)
    .order('created_at', { ascending: false });

  const subscribers = (rows ?? []).map((r: any) => {
    const plan = r.plan_type as string;
    const used = (r.tasks_created_this_month as number) ?? 0;
    const cap = PLAN_TASK_CAPS[plan] ?? 50;
    const periodEnd = r.current_period_end as string | null;

    // Projected exhaustion: days until cap hit at current daily velocity
    // Assume we're mid-month; use day-of-month as elapsed days
    const now = new Date();
    const dayOfMonth = now.getDate();
    const dailyVelocity = dayOfMonth > 0 ? used / dayOfMonth : 0;
    const remaining = cap === -1 ? Infinity : cap - used;
    const daysUntilExhaustion = dailyVelocity > 0 && cap !== -1
      ? Math.floor(remaining / dailyVelocity)
      : null;

    return {
      id: r.id as string,
      email: r.waitlist?.email ?? (r.subscriber as any)?.email ?? '',
      name: [r.waitlist?.first_name, r.waitlist?.last_name].filter(Boolean).join(' ') || r.waitlist?.email || (r.subscriber as any)?.display_name || (r.subscriber as any)?.email || '—',
      plan_type: plan,
      status_label: (r.system_status as any)?.label ?? null,
      external_subscription_id: r.external_subscription_id as string | null,
      external_customer_id: r.external_customer_id as string | null,
      tasks_used: used,
      tasks_cap: cap,
      renewal_date: periodEnd,
      renewal_amount_sgd: PLAN_PRICES_SGD[plan] ?? 0,
      days_until_exhaustion: daysUntilExhaustion,
    };
  });

  return (
    <div className="min-h-screen bg-[#0d0d0d] p-8">
      <div className="max-w-6xl mx-auto">

        <header className="mb-8 flex justify-between items-center">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[#00d4a1] font-bold text-lg tracking-tight">pmu</span>
              <span className="text-white font-bold text-lg tracking-tight">.sg</span>
            </div>
            <nav className="flex items-center gap-1 mt-2">
              <a href="/admin/settings" className="text-sm text-zinc-500 hover:text-white px-3 py-1.5 rounded-lg transition-colors">
                Governance
              </a>
              <a href="/admin/dashboard" className="text-sm text-zinc-500 hover:text-white px-3 py-1.5 rounded-lg transition-colors">
                Ontology
              </a>
              <a href="/admin/billing" className="text-sm text-white bg-zinc-800 border border-zinc-700 px-3 py-1.5 rounded-lg">
                Billing
              </a>
            </nav>
          </div>
          <form action={logoutAdmin}>
            <button type="submit" className="text-sm text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-500 rounded-lg px-4 py-2 transition-colors">
              Sign Out
            </button>
          </form>
        </header>

        <BillingDashboard subscribers={subscribers} leads={leads} />

      </div>
    </div>
  );
}
