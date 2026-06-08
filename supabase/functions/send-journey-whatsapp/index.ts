// supabase/functions/send-journey-whatsapp/index.ts
// Triggered by the journey system to auto-send WhatsApp messages.
// Called when a touchpoint with touchpoint_type='whatsapp_auto' becomes due.
//
// POST body: { touchpoint_id: number }
// Returns: { ok: true, message_id: string } | { ok: false, error: string }

// @ts-ignore
const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")               || "";
// @ts-ignore
const SERVICE_ROLE      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")  || "";
// @ts-ignore
const WA_PHONE_ID       = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")   || "";
// @ts-ignore
const WA_TOKEN          = Deno.env.get("WHATSAPP_ACCESS_TOKEN")      || "";

const CORS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function pgFetch(path: string, opts: RequestInit = {}): Promise<any> {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        ...opts,
        headers: {
            "apikey":         SERVICE_ROLE,
            "Authorization":  `Bearer ${SERVICE_ROLE}`,
            "Content-Type":   "application/json",
            "Accept":         "application/json",
            "Prefer":         "return=minimal",
            ...(opts.headers || {}),
        },
    });
    if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`pgFetch ${res.status} ${path}: ${txt.slice(0, 200)}`);
    }
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("json") && res.status !== 204) return res.json();
    return null;
}

async function pgSelect<T>(table: string, qs: string): Promise<T[]> {
    return (await pgFetch(`${table}?${qs}`, { method: "GET" })) || [];
}

async function pgPatch(table: string, qs: string, body: object): Promise<void> {
    await pgFetch(`${table}?${qs}`, { method: "PATCH", body: JSON.stringify(body) });
}

function interpolate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

async function sendWhatsApp(phone: string, text: string): Promise<string> {
    if (!WA_PHONE_ID || !WA_TOKEN) throw new Error("WhatsApp credentials not configured");

    const normalised = phone.replace(/[\s\-()]/g, "");
    const e164 = normalised.startsWith("+") ? normalised.slice(1) : normalised;

    const res = await fetch(
        `https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`,
        {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${WA_TOKEN}`,
                "Content-Type":  "application/json",
            },
            body: JSON.stringify({
                messaging_product: "whatsapp",
                to:   e164,
                type: "text",
                text: { body: text },
            }),
        }
    );

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `WA API ${res.status}`);
    }

    const data = await res.json();
    return data?.messages?.[0]?.id || "unknown";
}

// @ts-ignore
Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    try {
        const { touchpoint_id } = await req.json();
        if (!touchpoint_id) throw new Error("touchpoint_id required");

        // Load touchpoint
        const [tp] = await pgSelect<any>(
            "journey_touchpoints",
            `id=eq.${touchpoint_id}&select=id,prospect_id,customer_id,message_template,title,status`
        );
        if (!tp) throw new Error(`Touchpoint ${touchpoint_id} not found`);
        if (tp.status !== "pending" && tp.status !== "overdue") {
            return new Response(
                JSON.stringify({ ok: false, error: "Touchpoint not in sendable state" }),
                { headers: { ...CORS, "Content-Type": "application/json" }, status: 400 }
            );
        }

        // Resolve entity (prospect or customer) for phone + name
        let phone = "", name = "";
        if (tp.prospect_id) {
            const [p] = await pgSelect<any>(
                "prospects",
                `id=eq.${tp.prospect_id}&select=full_name,phone`
            );
            phone = p?.phone || "";
            name  = p?.full_name || "there";
        } else if (tp.customer_id) {
            const [c] = await pgSelect<any>(
                "customers",
                `id=eq.${tp.customer_id}&select=full_name,phone`
            );
            phone = c?.phone || "";
            name  = c?.full_name || "there";
        }

        if (!phone) throw new Error("No phone number on record");

        // Interpolate template
        const firstName = name.split(" ")[0];
        const text = interpolate(tp.message_template || tp.title, { name: firstName });

        const messageId = await sendWhatsApp(phone, text);

        // Mark touchpoint as auto_sent
        await pgPatch(
            "journey_touchpoints",
            `id=eq.${touchpoint_id}`,
            {
                status:               "auto_sent",
                completed_at:         new Date().toISOString(),
                whatsapp_message_id:  messageId,
            }
        );

        return new Response(
            JSON.stringify({ ok: true, message_id: messageId }),
            { headers: { ...CORS, "Content-Type": "application/json" }, status: 200 }
        );

    } catch (err: any) {
        console.error("[send-journey-whatsapp]", err?.message);
        return new Response(
            JSON.stringify({ ok: false, error: err?.message || "Unknown error" }),
            { headers: { ...CORS, "Content-Type": "application/json" }, status: 500 }
        );
    }
});
