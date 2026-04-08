import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { email, firstName, lastName, company, reason, source, bcaGrade, outreachStatus } = await request.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }

    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { error } = await supabase
      .from('waitlist')
      .insert([{
        email,
        first_name: firstName,
        last_name: lastName,
        company,
        reason,
        source: source ?? 'landing_page',
        bca_grade: bcaGrade ?? null,
        outreach_status: outreachStatus ?? 'new',
      }]);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}
