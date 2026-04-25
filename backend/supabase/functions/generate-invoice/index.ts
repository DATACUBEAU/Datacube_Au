import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getServiceClient, corsHeaders } from "../_shared/au.ts";
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { userId, amount, plan, refCode, paymentId } = await req.json();

    if (!userId || !amount || !refCode) {
        throw new Error("Missing invoice details: userId, amount, refCode required");
    }

    const supabaseAdmin = getServiceClient();

    // 1. Get User Details
    const { data: profile } = await supabaseAdmin
        .from('au_user_profiles')
        .select('full_name, au_users(email)')
        .eq('user_id', userId)
        .single();
    
    const email = profile?.au_users?.email || 'user@example.com';
    const name = profile?.full_name || 'Valued Customer';
    const date = new Date().toLocaleDateString();

    // 2. Generate PDF
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    page.drawText('INVOICE', { x: 50, y: height - 50, size: 30, font: boldFont });
    page.drawText('Datacube AU Systems', { x: 50, y: height - 80, size: 12, font });

    page.drawText(`Billed To:`, { x: 50, y: height - 120, size: 10, font: boldFont });
    page.drawText(`${name}`, { x: 50, y: height - 135, size: 10, font });
    page.drawText(`${email}`, { x: 50, y: height - 150, size: 10, font });

    page.drawText(`Invoice #: ${refCode}`, { x: 400, y: height - 120, size: 10, font });
    page.drawText(`Date: ${date}`, { x: 400, y: height - 135, size: 10, font });
    page.drawText(`Status: PAID`, { x: 400, y: height - 150, size: 10, font: boldFont, color: rgb(0, 0.5, 0) });

    // Table Header
    const tableTop = height - 200;
    page.drawLine({ start: { x: 50, y: tableTop }, end: { x: 550, y: tableTop }, thickness: 1 });
    page.drawText('Description', { x: 60, y: tableTop - 15, size: 10, font: boldFont });
    page.drawText('Amount', { x: 450, y: tableTop - 15, size: 10, font: boldFont });
    page.drawLine({ start: { x: 50, y: tableTop - 25 }, end: { x: 550, y: tableTop - 25 }, thickness: 1 });

    // Item
    page.drawText(`${plan || 'Pro'} Subscription`, { x: 60, y: tableTop - 45, size: 10, font });
    page.drawText(`NGN ${amount}`, { x: 450, y: tableTop - 45, size: 10, font });

    // Total
    page.drawLine({ start: { x: 50, y: tableTop - 65 }, end: { x: 550, y: tableTop - 65 }, thickness: 1 });
    page.drawText('Total', { x: 350, y: tableTop - 85, size: 12, font: boldFont });
    page.drawText(`NGN ${amount}`, { x: 450, y: tableTop - 85, size: 12, font: boldFont });

    const pdfBytes = await pdfDoc.save();

    const invoiceBucket =
      Deno.env.get("SUPABASE_INVOICE_BUCKET") ??
      Deno.env.get("SUPABASE_BUCKET") ??
      Deno.env.get("NEXT_PUBLIC_SUPABASE_BUCKET") ??
      "documents";

    const filePath = `invoices/${userId}/latest.pdf`;
    const uploadRes = await supabaseAdmin.storage
      .from(invoiceBucket)
      .upload(filePath, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (uploadRes.error) throw new Error(uploadRes.error.message);

    const signed = await supabaseAdmin.storage
      .from(invoiceBucket)
      .createSignedUrl(filePath, 60 * 60 * 24 * 365);
    if (signed.error || !signed.data?.signedUrl) throw new Error(signed.error?.message || "Failed to create signed URL");
    const downloadURL = signed.data.signedUrl;

    // 5. Send Email (Resend)
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey) {
        await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${resendKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                from: "Datacube AU <billing@datacube.au>",
                to: [email],
                subject: `Invoice #${refCode}`,
                html: `<p>Thank you for your payment of NGN ${amount}.</p><p>You can download your invoice here: <a href="${downloadURL}">Download Invoice</a></p>`
            })
        });
    }

    // 6. Update User Profile
    await supabaseAdmin
        .from('au_user_profiles')
        .update({ latest_invoice_url: downloadURL })
        .eq('user_id', userId);

    return new Response(JSON.stringify({ ok: true, url: downloadURL }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error("Generate Invoice Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
