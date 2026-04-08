'use client';

import { useState } from 'react';

export default function BCALandingPage() {
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', company: '', role: '' });
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  // Capture ?source= from URL so outreach links auto-tag the lead
  const source = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('source') ?? 'bca_outreach'
    : 'bca_outreach';

  const bcaGrade = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('grade') ?? null
    : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('loading');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email,
          firstName: form.firstName,
          lastName: form.lastName,
          company: form.company,
          reason: form.role,
          source,
          bcaGrade,
          outreachStatus: 'new',
        }),
      });
      if (!res.ok) throw new Error();
      setStatus('done');
    } catch {
      setStatus('error');
    }
  }

  const inputClass = "w-full bg-[#1a1a1a] border border-zinc-700 rounded-lg px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-[#00d4a1] transition-colors";

  return (
    <div className="min-h-screen bg-[#0d0d0d] text-white">

      {/* Nav */}
      <nav className="border-b border-zinc-800 px-6 py-4 flex items-center gap-2">
        <span className="text-[#00d4a1] font-bold text-lg tracking-tight">pmu</span>
        <span className="text-white font-bold text-lg tracking-tight">.sg</span>
      </nav>

      <main className="max-w-2xl mx-auto px-6 py-20">

        {/* Hero */}
        <div className="mb-12">
          <div className="inline-block text-xs font-semibold text-[#00d4a1] bg-[#00d4a1]/10 px-3 py-1 rounded-full mb-6 tracking-wider uppercase">
            BCA Site Diary Automation
          </div>
          <h1 className="text-4xl font-bold leading-tight mb-5">
            Stop Writing BCA Diaries From WhatsApp Yourself
          </h1>
          <p className="text-zinc-400 text-lg leading-relaxed">
            Site engineers at Singapore's top General Building contractors spend two hours every evening manually compiling WhatsApp messages and site photos into BCA Reg 22 daily diary entries — Miyu does it for them in real time.
          </p>
        </div>

        {/* Outcome bullets */}
        <ul className="space-y-4 mb-12">
          {[
            'Your daily diary is drafted and ready before you leave site, compiled automatically from the WhatsApp messages your team already sends.',
            'Every entry meets BCA Reg 22 format out of the box — no reformatting, no chasing sub-contractors for missing information the night before an inspection.',
            'Site Coordinators and QS staff reclaim evenings and weekends, with a full audit trail that survives any BCA spot check or project dispute.',
          ].map((point, i) => (
            <li key={i} className="flex items-start gap-3">
              <div className="w-1.5 h-1.5 rounded-full bg-[#00d4a1] mt-2 shrink-0" />
              <p className="text-zinc-300 leading-relaxed">{point}</p>
            </li>
          ))}
        </ul>

        {/* Form */}
        {status === 'done' ? (
          <div className="bg-[#00d4a1]/10 border border-[#00d4a1]/30 rounded-2xl p-8 text-center">
            <div className="text-[#00d4a1] text-2xl font-bold mb-2">You're in.</div>
            <p className="text-zinc-400 text-sm">We'll be in touch within one business day to schedule your 15-minute demo.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-[#1a1a1a] border border-zinc-800 rounded-2xl p-8 space-y-4">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-2">Book a 15-minute demo</h2>

            <div className="grid grid-cols-2 gap-4">
              <input
                required
                type="text"
                placeholder="First name"
                value={form.firstName}
                onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))}
                className={inputClass}
              />
              <input
                type="text"
                placeholder="Last name"
                value={form.lastName}
                onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))}
                className={inputClass}
              />
            </div>

            <input
              required
              type="email"
              placeholder="Work email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              className={inputClass}
            />

            <input
              type="text"
              placeholder="Company name"
              value={form.company}
              onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
              className={inputClass}
            />

            <input
              type="text"
              placeholder="Your role (e.g. Project Manager, Site Engineer)"
              value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
              className={inputClass}
            />

            {status === 'error' && (
              <p className="text-red-400 text-sm">Something went wrong — please try again.</p>
            )}

            <button
              type="submit"
              disabled={status === 'loading'}
              className="w-full bg-[#00d4a1] hover:bg-[#00bfa0] disabled:opacity-50 text-black font-semibold py-3 rounded-lg transition-colors text-sm"
            >
              {status === 'loading' ? 'Submitting…' : 'Join the Pilot'}
            </button>

            <p className="text-zinc-600 text-xs text-center leading-relaxed">
              Miyu generates daily site diary entries in compliance with Regulation 22 of the Building Control Regulations. Pilot access is provided at no charge for the first 60 days — no credit card required.
            </p>
          </form>
        )}

      </main>
    </div>
  );
}
