import { NextResponse } from "next/server";
import {
  READ_SNIFFER_PROVIDERS,
  WRITE_SNIFFER_PROVIDERS,
  READ_SNIFFER_SETTINGS,
  WRITE_SNIFFER_SETTINGS,
  seedInitialCandidatesIfEmpty,
  verifyCandidate,
  isAlreadyInRegistry,
  generateRegistryDraft,
  scanFreeLlmCatalog,
  installToRegistry,
  fetchProviderLogo,
  crawlProviderLogos,
} from "@/lib/providerSniffer.js";

export const dynamic = "force-dynamic";

// GET /api/provider-sniffer → list providers, settings, stats
export async function GET() {
  try {
    let providers = await READ_SNIFFER_PROVIDERS();
    if (!providers || providers.length === 0) {
      providers = await seedInitialCandidatesIfEmpty();
    }
    const settings = await READ_SNIFFER_SETTINGS();

    const stats = {
      total: providers.length,
      candidate: providers.filter((p) => p.status === "candidate").length,
      verified: providers.filter((p) => p.status === "verified").length,
      registered: providers.filter((p) => p.status === "registered").length,
      ignored: providers.filter((p) => p.status === "ignored").length,
      failed: providers.filter((p) => p.status === "failed").length,
    };

    return NextResponse.json({ providers, settings, stats });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/provider-sniffer → action dispatcher (verify, status, add, generateDraft)
export async function POST(request) {
  try {
    const body = await request.json();
    const { action, id, providerData, status, apiKey } = body;

    let providers = await READ_SNIFFER_PROVIDERS();
    if (!providers || providers.length === 0) {
      providers = await seedInitialCandidatesIfEmpty();
    }

    if (action === "add") {
      if (!providerData || !providerData.id || !providerData.baseUrl) {
        return NextResponse.json({ error: "id and baseUrl are required" }, { status: 400 });
      }

      // Check dupes
      const dupeCheck = isAlreadyInRegistry(providerData.id, providerData.baseUrl);
      const newEntry = {
        ...providerData,
        status: dupeCheck.inRegistry ? "registered" : (providerData.status || "candidate"),
        discoveredFrom: providerData.discoveredFrom || "Manual User Entry",
        lastVerifiedAt: null,
      };

      // Upsert
      const idx = providers.findIndex((p) => p.id === newEntry.id);
      if (idx >= 0) {
        providers[idx] = { ...providers[idx], ...newEntry };
      } else {
        providers.unshift(newEntry);
      }

      await WRITE_SNIFFER_PROVIDERS(providers);
      return NextResponse.json({ ok: true, provider: newEntry, dupeCheck });
    }

    if (action === "verify") {
      const target = providers.find((p) => p.id === id);
      if (!target) {
        return NextResponse.json({ error: `Provider ${id} not found` }, { status: 404 });
      }

      const res = await verifyCandidate(target, apiKey);
      target.lastVerifiedAt = new Date().toISOString();
      if (res.ok) {
        target.status = target.status === "registered" ? "registered" : "verified";
        target.verificationError = null;
        target.verificationNote = res.note;
        target.latencyMs = res.latencyMs;
      } else {
        target.status = "failed";
        target.verificationError = res.error;
      }

      await WRITE_SNIFFER_PROVIDERS(providers);
      return NextResponse.json({ ok: true, result: res, provider: target });
    }

    if (action === "updateStatus") {
      const target = providers.find((p) => p.id === id);
      if (!target) {
        return NextResponse.json({ error: `Provider ${id} not found` }, { status: 404 });
      }

      target.status = status;
      await WRITE_SNIFFER_PROVIDERS(providers);
      return NextResponse.json({ ok: true, provider: target });
    }

    if (action === "generateDraft") {
      const target = providers.find((p) => p.id === id);
      if (!target) {
        return NextResponse.json({ error: `Provider ${id} not found` }, { status: 404 });
      }

      const draftCode = generateRegistryDraft(target);
      return NextResponse.json({ ok: true, draftCode, filename: `open-sse/providers/registry/${target.id}.js` });
    }

    if (action === "install") {
      const target = providers.find((p) => p.id === id);
      if (!target) {
        return NextResponse.json({ error: `Provider ${id} not found` }, { status: 404 });
      }

      const dupeCheck = isAlreadyInRegistry(target.id, target.baseUrl);
      if (dupeCheck.inRegistry) {
        return NextResponse.json({
          error: `Provider ${target.id} is already in the 9router registry (${dupeCheck.registeredId}).`,
        }, { status: 409 });
      }

      const result = await installToRegistry(target);
      target.status = "registered";
      target.installedAt = new Date().toISOString();
      await WRITE_SNIFFER_PROVIDERS(providers);
      return NextResponse.json({ ok: true, ...result, provider: target });
    }

    if (action === "logo") {
      const target = providers.find((p) => p.id === id);
      if (!target) {
        return NextResponse.json({ error: `Provider ${id} not found` }, { status: 404 });
      }
      const result = await fetchProviderLogo(target);
      return NextResponse.json({ ok: result.ok, result });
    }

    if (action === "crawlLogos") {
      const result = await crawlProviderLogos(id ? providers.filter((p) => p.id === id) : providers);
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "scan") {
      const result = await scanFreeLlmCatalog();
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "delete") {
      providers = providers.filter((p) => p.id !== id);
      await WRITE_SNIFFER_PROVIDERS(providers);
      return NextResponse.json({ ok: true, providers });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
