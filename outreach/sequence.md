# Outreach Sequence — BCA Contractor Targets

## Target Companies (Priority Order)

| # | Company | BCA Grade | Pain Signal | Contact Role |
|---|---|---|---|---|
| 1 | Woh Hup (Private) Limited | A1 | Job ads requiring "daily site diary compilation" and "BCA report submission"; no IDD automation on wohhup.com | Project Manager / Senior Site Engineer |
| 2 | Lum Chang Holdings | A1 | Multi-trade sites (MRT, hospitals, HDB SERS); careers page: "preparation of progress reports and regulatory submissions"; no IDD/AI tooling | Project Director / Project Manager |
| 3 | Kimly Construction | A1 | SGX-listed (1D0); headcount-heavy site supervision; no digital diary in annual reports; high-volume repetitive Reg 22 workload from HDB pipeline | Senior Project Manager / Contracts Manager |
| 4 | Hexacon Construction | A1 | Lean head-office = site engineers carry heavier documentation burden; no IDD mentioned; active project load $50M–$150M range | Project Manager / Site Engineer |
| 5 | Obayashi Singapore | A1 | Must satisfy BCA Reg 22 AND internal Obayashi Japan reporting formats simultaneously — double-compilation burden | Project Manager / Deputy PM |

---

## Message Templates

### LinkedIn DM (≤3 sentences)

> Hi [Name], site engineers at [Company] working on [Project] are still compiling BCA daily diaries manually from WhatsApp threads at 10 PM — we built a tool that converts those messages into Reg 22-compliant entries automatically. Would it be worth a 15-minute call to see if it fits your workflow?

---

### Email

**Subject:** BCA daily diaries — stop compiling them manually

**Body:**

> Hi [Name], I know site engineers at [Company] are spending evenings turning WhatsApp message threads into BCA Reg 22 daily diary entries by hand — it is one of the most consistent pain points we hear from General Building contractors in Singapore. We built Miyu specifically to intercept those WhatsApp messages and generate compliant diary entries automatically, so your team can close out each day in under two minutes rather than two hours. We are currently running a no-cost 60-day pilot with A1 contractors and would love to show you how it works on a project like [Project]. Can we schedule a 15-minute call this week?

---

## Sequence

| Day | Action |
|---|---|
| 0 | LinkedIn connection request (no note) |
| 2 | LinkedIn DM (template above) |
| 5 | Email follow-up if no reply |
| 10 | Final bump: "Closing the loop — happy to share a one-pager if useful." |

---

## Tracking

Log each contact into the admin leads pipeline at `/admin/billing` (Leads tab).
Set `source = bca_outreach`, enter the BCA grade, and update `outreach_status` as the sequence progresses.

Outreach link for inbound from emails/DMs: `https://pmu.sg/bca?source=bca_outreach&grade=A1`
