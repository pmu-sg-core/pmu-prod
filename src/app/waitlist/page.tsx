'use client';

import { useState, useEffect, useRef } from 'react';

// --- Animated counter hook ---
function useCountUp(target: number, duration = 1800, start = false) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!start) return;
    let startTime: number | null = null;
    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.floor(eased * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [start, target, duration]);
  return value;
}

// --- Intersection observer hook ---
function useInView(threshold = 0.2) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setInView(true); observer.disconnect(); }
    }, { threshold });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [threshold]);
  return { ref, inView };
}

// --- Stat card ---
function StatCard({ value, suffix, label, start }: { value: number; suffix: string; label: string; start: boolean }) {
  const count = useCountUp(value, 1600, start);
  return (
    <div className="flex flex-col items-center text-center p-6">
      <span className="text-5xl font-black text-white tracking-tight font-display">
        {count}{suffix}
      </span>
      <span className="mt-2 text-sm text-slate-400 font-mono uppercase tracking-widest">{label}</span>
    </div>
  );
}

// --- Feature pill ---
function FeaturePill({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-xs font-mono text-emerald-400">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
      {text}
    </span>
  );
}

// --- Pricing tier ---
function PricingCard({
  tier, price, unit, target, features, highlighted = false, disabled = false
}: {
  tier: string; price: string; unit: string; target: string; features: string[]; highlighted?: boolean; disabled?: boolean;
}) {
  return (
    <div className={`relative rounded-2xl p-6 flex flex-col gap-4 transition-all duration-300 ${
      highlighted
        ? 'bg-emerald-950/60 border border-emerald-500/40 shadow-[0_0_40px_rgba(16,185,129,0.12)]'
        : disabled
          ? 'bg-slate-900/30 border border-slate-800/40 opacity-70'
          : 'bg-slate-900/60 border border-slate-800/70 hover:border-slate-700'
    }`}>
      {highlighted && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-emerald-500 text-xs font-bold text-black tracking-wide uppercase">
          PSG-Eligible
        </div>
      )}
      {disabled && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-slate-700 text-xs font-bold text-white tracking-wide uppercase">
          Coming Q4 2026
        </div>
      )}
      <div>
        <div className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-1">{tier}</div>
        <div className="text-3xl font-black text-white font-display">{price}<span className="text-base font-normal text-slate-400">/{unit}</span></div>
        <div className="text-xs text-slate-500 mt-1">{target}</div>
      </div>
      <ul className="flex flex-col gap-2 flex-1">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
            <svg className={`w-4 h-4 mt-0.5 shrink-0 ${disabled ? 'text-slate-500' : 'text-emerald-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function WaitlistPage() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [reason, setReason] = useState('sme_ops');
  const [submitted, setSubmitted] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const { ref: statsRef, inView: statsInView } = useInView(0.3);
  const { ref: featuresRef, inView: featuresInView } = useInView(0.1);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', handler);
    return () => window.removeEventListener('scroll', handler);
  }, []);

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, firstName, lastName, company, reason }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? 'Something went wrong. Please try again.');
      } else {
        setSubmitted(true);
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#060b12] text-slate-200 font-sans selection:bg-emerald-500/30 overflow-x-hidden">

      {/* Ambient background glow */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-15%] left-[-10%] w-[55vw] h-[55vw] rounded-full bg-emerald-950/20 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40vw] h-[40vw] rounded-full bg-teal-950/15 blur-[100px]" />
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)',
          backgroundSize: '48px 48px'
        }} />
      </div>

      {/* Navigation */}
      <header className={`border-b sticky top-0 z-50 transition-all duration-300 ${
        scrolled ? 'border-slate-800/80 bg-[#060b12]/90 backdrop-blur-xl shadow-lg shadow-black/20' : 'border-transparent bg-transparent'
      }`}>
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="font-mono font-extrabold text-lg tracking-tight flex items-center gap-2">
            <div className="w-6 h-6 bg-emerald-500 rounded flex items-center justify-center shadow-[0_0_14px_rgba(16,185,129,0.6)]">
              <svg className="w-3.5 h-3.5 text-black" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            pmu<span className="text-emerald-400">.sg</span>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm text-slate-400">
            <a href="#solution" className="hover:text-white transition-colors">How it Works</a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
          </nav>
          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-xs font-mono text-emerald-400 border border-emerald-900/50 bg-emerald-500/10 px-2 py-1 rounded">Private Beta</span>
            <a href="#waitlist" className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg transition-colors">
              Get Early Access
            </a>
          </div>
        </div>
      </header>

      <main className="relative z-10">

        {/* Hero */}
        <section className="max-w-6xl mx-auto px-6 pt-24 pb-20">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800/60 border border-slate-700 text-xs font-mono text-emerald-400 mb-6">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                Now onboarding Singapore SMEs
              </div>
              <h1 className="text-5xl lg:text-6xl font-black tracking-tight mb-6 text-white leading-[1.05]">
                Project management<br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-300">without the data entry.</span>
              </h1>
              <p className="text-lg text-slate-400 mb-4 leading-relaxed max-w-lg">
                Pmu.sg turns your team&apos;s messages into structured tickets across Jira, Monday.com, Asana, and Trello — instantly. If you can text, you can manage.
              </p>
              <p className="text-sm text-slate-500 mb-8 max-w-md">
                Meet Miyu, your AI project coordinator. She listens, logs, and executes — eliminating 80% of manual project admin so you can focus on delivery, not documentation.
              </p>
              <div className="flex flex-wrap gap-2 mb-8">
                <FeaturePill text="WhatsApp Native" />
                <FeaturePill text="Jira · Monday · Asana · Trello" />
                <FeaturePill text="SME Grant Eligible" />
              </div>
              <a href="#waitlist" className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-3 rounded-xl font-semibold transition-all duration-200 hover:shadow-[0_0_24px_rgba(16,185,129,0.4)]">
                Join the SME Waitlist
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </a>
            </div>

            {/* Hero visual */}
            <div className="hidden lg:flex justify-center items-center">
              <div className="relative w-full max-w-sm">
                <div className="absolute inset-0 bg-emerald-500/5 blur-3xl scale-110 rounded-full" />
                <div className="relative flex flex-col items-center gap-3">

                  {/* Input channels */}
                  <div className="grid grid-cols-2 gap-3 w-full">
                    {[
                      { label: 'WhatsApp', msg: 'Voice note — 0:12', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20',
                        icon: <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/> },
                      { label: 'Slack', msg: '#proj-alpha · just now', color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20',
                        icon: <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/> },
                      { label: 'Telegram', msg: 'Team chat · 2 min ago', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20',
                        icon: <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/> },
                      { label: 'Teams', msg: 'General · just now', color: 'text-indigo-400', bg: 'bg-indigo-500/10 border-indigo-500/20',
                        icon: <path d="M20.625 7.5h-5.25a.375.375 0 0 0-.375.375v5.25c0 .207.168.375.375.375h5.25A.375.375 0 0 0 21 13.125v-5.25a.375.375 0 0 0-.375-.375zM14.25 4.5A2.25 2.25 0 1 0 14.25 9a2.25 2.25 0 0 0 0-4.5zM9 4.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm0 7.5c-3.315 0-6 1.343-6 3v.75h12V15c0-1.657-2.685-3-6-3z"/> },
                    ].map(({ label, msg, color, bg, icon }) => (
                      <div key={label} className={`rounded-xl p-3 border ${bg} backdrop-blur-sm`}>
                        <div className="flex items-center gap-2 mb-1">
                          <svg className={`w-3.5 h-3.5 ${color} shrink-0`} viewBox="0 0 24 24" fill="currentColor">{icon}</svg>
                          <span className={`text-[11px] font-mono font-bold ${color}`}>{label}</span>
                        </div>
                        <p className="text-[10px] text-slate-500 font-mono">{msg}</p>
                      </div>
                    ))}
                  </div>

                  {/* Converging arrow to Miyu */}
                  <div className="flex flex-col items-center gap-1 py-1">
                    <div className="flex gap-6">
                      <div className="w-px h-4 bg-gradient-to-b from-transparent to-emerald-500/60" />
                      <div className="w-px h-4 bg-gradient-to-b from-transparent to-emerald-500/60" />
                      <div className="w-px h-4 bg-gradient-to-b from-transparent to-emerald-500/60" />
                      <div className="w-px h-4 bg-gradient-to-b from-transparent to-emerald-500/60" />
                    </div>
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold text-sm font-mono shadow-[0_0_16px_rgba(16,185,129,0.25)]">
                      M
                    </div>
                    <span className="text-[10px] font-mono text-emerald-400">Miyu · Reasoning</span>
                    <div className="w-px h-4 bg-gradient-to-b from-emerald-500/60 to-transparent" />
                  </div>

                  {/* Output tools */}
                  <div className="w-full space-y-2">
                    <div className="text-[10px] font-mono text-slate-500 uppercase tracking-widest text-center mb-3">Synced to your tools</div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { name: 'Jira', ref: 'JIRA-1042', task: 'Implement New Header UI', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20' },
                        { name: 'Monday.com', ref: 'Item #892', task: 'Client UI Approval — Dev', color: 'text-pink-400', bg: 'bg-pink-500/10 border-pink-500/20' },
                        { name: 'Asana', ref: 'Task #4471', task: 'Header redesign — Sarah', color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20' },
                        { name: 'Trello', ref: 'Card created', task: 'New Header · In Progress', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
                      ].map(({ name, ref, task, color, bg }) => (
                        <div key={name} className={`rounded-xl p-3 border ${bg} relative`}>
                          <div className="absolute -top-1.5 -right-1.5 w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]" />
                          <div className={`text-[10px] font-mono font-bold ${color} mb-1`}>{name}</div>
                          <div className="text-[10px] text-slate-500 font-mono">{ref}</div>
                          <div className="text-[11px] text-white mt-1 leading-tight">{task}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Stats */}
        <section ref={statsRef} className="border-y border-slate-800/60 bg-slate-900/30">
          <div className="max-w-6xl mx-auto px-6 py-12 grid grid-cols-2 md:grid-cols-4 gap-0 divide-x divide-slate-800/60">
            <StatCard value={90} suffix="%" label="PM time wasted on data entry" start={statsInView} />
            <StatCard value={15} suffix="+" label="Hours saved per week" start={statsInView} />
            <StatCard value={4200} suffix="" label="S$ monthly cost of a junior coordinator" start={statsInView} />
            <StatCard value={2} suffix="s" label="Seconds to sync any message to your PM tool" start={statsInView} />
          </div>
        </section>

        {/* The Problem / Solution */}
        <section className="max-w-6xl mx-auto px-6 py-24">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <div className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">The Problem</div>
              <h2 className="text-3xl font-black text-white mb-5 leading-tight">Project management has become &quot;Data Entry Management.&quot;</h2>
              <p className="text-slate-400 leading-relaxed mb-6">
                Your team lives in chat apps, but your business needs the structure of Jira, Monday.com, or Asana. The &quot;Human Latency Tax&quot; happens when PMs spend hours manually translating messages into tickets, slowing down actual work.
              </p>
              <div className="space-y-4">
                {[
                  { icon: '📱', title: 'The WhatsApp Black Hole', desc: 'Decisions happen in chat, but never make it to the project board.' },
                  { icon: '💸', title: 'Expensive Admin', desc: 'You are paying S$4,200/mo for a junior coordinator just to copy-paste updates — and when they are overloaded or locked out of classified projects, your PM is left without cover.' },
                  { icon: '🤖', title: "Chatbots Can't Execute", desc: "Standard AI can chat, but it can't securely log into your systems and build tickets." },
                ].map((item) => (
                  <div key={item.title} className="flex items-start gap-4 p-4 rounded-xl bg-slate-900/50 border border-slate-800/60">
                    <span className="text-2xl">{item.icon}</span>
                    <div>
                      <div className="text-sm font-semibold text-white mb-1">{item.title}</div>
                      <div className="text-sm text-slate-400">{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">The Solution</div>
              <h2 className="text-3xl font-black text-white mb-5 leading-tight">Miyu — your System of Action.</h2>
              <p className="text-slate-400 leading-relaxed mb-6">
                Pmu.sg connects your daily chats directly to your project tools. Miyu, our agentic AI, listens to your voice notes, understands the context, and executes the admin work instantly.
              </p>
              <div className="space-y-3">
                {[
                  'Zero training required: Just message Miyu',
                  'Automatically generates titles, descriptions, and assigns owners',
                  'Creates tasks in Jira, Monday.com, Asana, or Trello in seconds',
                  'You retain total control: Draft mode available for PM approval',
                  'Bank-grade security: Your data stays strictly in Singapore',
                ].map((item) => (
                  <div key={item} className="flex items-center gap-3 text-sm text-slate-300">
                    <div className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0">
                      <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* How it Works */}
        <section id="solution" ref={featuresRef} className="border-t border-slate-800/60 bg-slate-900/20 py-24">
          <div className="max-w-6xl mx-auto px-6">
            <div className="text-center mb-14">
              <div className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">How it works</div>
              <h2 className="text-3xl font-black text-white">The Agile Workflow.</h2>
              <p className="text-slate-400 mt-3 max-w-xl mx-auto">Built specifically for startups, boutique agencies, and fast-moving SME teams.</p>
            </div>

            <div className={`flex flex-col md:flex-row items-center justify-center gap-4 md:gap-0 transition-all duration-700 ${featuresInView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
              <div className="flex-1 bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6 text-center z-10 w-full">
                <div className="w-12 h-12 mx-auto bg-blue-500/10 border border-blue-500/20 rounded-full flex items-center justify-center text-xl mb-4">💬</div>
                <h3 className="font-bold text-white mb-2">1. You Speak</h3>
                <p className="text-sm text-slate-400">Send a quick WhatsApp voice note to your Miyu project number while on the go.</p>
              </div>

              <div className="hidden md:flex flex-col items-center justify-center w-16 text-emerald-500/50">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </div>

              <div className="flex-1 bg-emerald-950/20 border border-emerald-500/30 rounded-2xl p-6 text-center z-10 w-full shadow-[0_0_30px_rgba(16,185,129,0.05)]">
                <div className="w-12 h-12 mx-auto bg-emerald-500/20 border border-emerald-500/40 rounded-full flex items-center justify-center text-xl mb-4">🧠</div>
                <h3 className="font-bold text-white mb-2">2. Miyu Reasons</h3>
                <p className="text-sm text-slate-400">Our Agentic Engine parses the intent, identifies the project, and formulates the task details securely.</p>
              </div>

              <div className="hidden md:flex flex-col items-center justify-center w-16 text-emerald-500/50">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </div>

              <div className="flex-1 bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6 text-center z-10 w-full">
                <div className="w-12 h-12 mx-auto bg-purple-500/10 border border-purple-500/20 rounded-full flex items-center justify-center text-xl mb-4">✅</div>
                <h3 className="font-bold text-white mb-2">3. Your Tools Sync</h3>
                <p className="text-sm text-slate-400">The task is instantly created in Jira, Monday.com, Asana, or Trello — fully formatted and assigned.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="border-t border-slate-800/60 py-24">
          <div className="max-w-6xl mx-auto px-6">
            <div className="text-center mb-14">
              <div className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">Pricing</div>
              <h2 className="text-3xl font-black text-white">Scale your PM capacity.</h2>
              <p className="text-slate-400 mt-3 max-w-xl mx-auto">Your team deserves better than copy-pasting. Give them Miyu.</p>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              <PricingCard
                tier="Lite"
                price="S$149"
                unit="mo"
                target="Freelancers & boutique agencies"
                features={[
                  'WhatsApp native interface',
                  'Up to 50 AI task actions/mo',
                  'Jira, Monday.com, Asana & Trello',
                  '2 channels · 5 team members',
                  'Governance audit trail',
                  'Community support',
                ]}
              />
              <PricingCard
                tier="Pro"
                price="S$449"
                unit="mo"
                target="Growing SMEs (PSG-Eligible)"
                highlighted
                features={[
                  'Everything in Lite',
                  'Up to 200 AI task actions/mo',
                  'Microsoft Teams + WhatsApp',
                  '4 channels · 20 team members',
                  'Task reassignment & approvals',
                  'Chat history & knowledge base',
                  'Priority support',
                ]}
              />
              <PricingCard
                tier="Corporate"
                price="Custom"
                unit="mo"
                target="Regulated industries"
                disabled
                features={[
                  'Unlimited AI task actions',
                  'Unlimited channels & members',
                  'SSO via Microsoft Entra ID',
                  'MAS / IMDA audit-ready logs',
                  'Custom ERP & system adapters',
                  'Dedicated success manager',
                ]}
              />
            </div>
            <p className="text-xs text-slate-600 mt-6 text-center">Singapore SMEs may be eligible to claim up to 70–90% of subscription costs under the WSG Job Redesign (JR+) and EnterpriseSG grants.</p>
          </div>
        </section>

        {/* Waitlist */}
        <section id="waitlist" className="border-t border-slate-800/60 bg-gradient-to-b from-slate-900/30 to-emerald-950/10 py-28">
          <div className="max-w-lg mx-auto px-6 text-center">
            <h2 className="text-4xl font-black text-white mb-4 leading-tight">
              Ready to stop<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-300">copying and pasting?</span>
            </h2>
            <p className="text-slate-400 mb-8">Join the Private Beta waitlist. We are currently onboarding a select group of Singapore SMEs to shape the future of project management.</p>

            <div className="bg-slate-900/80 border border-slate-800 p-7 rounded-2xl shadow-2xl backdrop-blur-sm">
              {!submitted ? (
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                  <div className="flex gap-3">
                    <input
                      placeholder="First Name"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      required
                      className="w-1/2 bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
                    />
                    <input
                      placeholder="Last Name"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="w-1/2 bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
                    />
                  </div>
                  <input
                    placeholder="Company Name"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    className="bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
                  />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@yourcompany.com.sg"
                    className="bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
                  />
                  <select
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-300 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
                  >
                    <option value="sme_ops">Automating SME Operations</option>
                    <option value="startup_scale">Scaling Startup Workflows</option>
                    <option value="ai_gov">Agentic AI Governance</option>
                    <option value="research">General Research</option>
                  </select>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed text-white py-2.5 rounded-xl text-sm font-semibold transition-all hover:shadow-[0_0_20px_rgba(16,185,129,0.35)]"
                  >
                    {loading ? 'Submitting...' : 'Request Access'}
                  </button>
                  {error && <p className="text-xs text-red-400 text-left">{error}</p>}
                  <p className="text-xs text-slate-500 text-left">
                    We&apos;ll reach out within 48 hours. No spam, ever.
                  </p>
                </form>
              ) : (
                <div className="py-6 text-center">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 mb-4">
                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">You&apos;re on the list.</h3>
                  <p className="text-sm text-slate-400">Keep an eye on your inbox. We&apos;ll be in touch regarding SME early access.</p>
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/60 bg-slate-950">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="font-mono font-extrabold text-sm flex items-center gap-2 text-slate-400">
            <div className="w-4 h-4 bg-emerald-500 rounded-sm shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
            pmu<span className="text-emerald-400">.sg</span>
            <span className="text-slate-700 ml-2">&middot; <a href="https://cloudlabhub.sg" target="_blank" rel="noopener noreferrer" className="hover:text-slate-400 transition-colors">Cloudlab Technology Services</a></span>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono text-slate-600">
            <span>Built for SG SMEs and Enterprises</span>
            <span>&middot;</span>
            <span>Data stays in Singapore</span>
            <span>&middot;</span>
            <span>&copy; 2026</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
