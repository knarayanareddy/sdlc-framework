// Scanner output → the one lead shape the hunters consume: {tool, rule, file, line, text, severity}.
// Every parser here is fed a fixture in leads.test.mjs. A scanner whose output we cannot parse
// is NOT_VERIFIED for lead extraction, never "clean".

export function lead(tool, rule, file, line, text, severity) {
  return { tool, rule: String(rule), file: String(file), line: Number(line) || 0, text: String(text).slice(0, 400), severity };
}

export function fromSemgrep(json) {
  const results = json.results ?? [];
  return results.map((r) =>
    lead("semgrep", r.check_id, r.path, r.start?.line, `${r.extra?.severity ?? ""} ${r.extra?.message ?? r.check_id}`.trim(), String(r.extra?.severity ?? "").toLowerCase()),
  );
}

export function fromSarif(json) {
  const out = [];
  for (const run of json.runs ?? []) {
    const rules = new Map((run.tool?.driver?.rules ?? []).map((r) => [r.id, r]));
    for (const res of run.results ?? []) {
      const loc = res.locations?.[0]?.physicalLocation;
      out.push(
        lead(
          run.tool?.driver?.name ?? "sarif",
          res.ruleId,
          loc?.artifactLocation?.uri ?? "unknown",
          loc?.region?.startLine,
          `${rules.get(res.ruleId)?.shortDescription?.text ?? res.message?.text ?? ""}`,
          String(res.level ?? "").toLowerCase(),
        ),
      );
    }
  }
  return out;
}

export function fromZap(json) {
  const out = [];
  for (const site of json.site ?? []) {
    for (const alert of site.alerts ?? []) {
      for (const inst of alert.instances ?? [{}]) {
        out.push(
          lead(
            "zap",
            `${alert.pluginid ?? ""} ${alert.name ?? alert.alert ?? ""}`.trim(),
            inst.uri ?? site["@name"] ?? "unknown",
            0,
            `${alert.riskdesc ?? alert.risk ?? ""} ${alert.desc ?? ""}`.trim(),
            String(alert.riskdesc ?? alert.risk ?? "").split(" ")[0].toLowerCase(),
          ),
        );
      }
    }
  }
  return out;
}

// Schemathesis and most property-based runners emit JUnit XML. Without this parser the
// `junit` format was declared in dast.mjs and silently produced zero leads (B-02).
export function fromJunit(xml) {
  const out = [];
  const attr = (text, name) => (String(text).match(new RegExp(`${name}="([^"]*)"`)) ?? [])[1] ?? "";
  for (const m of String(xml).matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const attrs = m[1] ?? "";
    const body = m[2] ?? "";
    const failure = body.match(/<(failure|error)\b([^>]*)>([\s\S]*?)<\/\1>/) ?? body.match(/<(failure|error)\b([^>]*?)\/>/);
    if (!failure) continue;
    const message = (attr(failure[2], "message") || (failure[3] ?? "").trim() || "failed").slice(0, 300);
    const name = attr(attrs, "name") || attr(attrs, "classname") || "testcase";
    const severity = String(failure[1]) === "error" ? "high" : "medium";
    out.push(lead("junit", name, attr(attrs, "file") || "unknown", 0, message, severity));
  }
  return out;
}

export function fromNuclei(jsonl) {
  const out = [];
  for (const line of String(jsonl).split("\n")) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    out.push(lead("nuclei", e["template-id"] ?? e.templateID, e["matched-at"] ?? e.host, 0, `${e.info?.name ?? ""} ${e.info?.severity ?? ""}`.trim(), e.info?.severity));
  }
  return out;
}


export function leadsFromFuzz(json, contractPath) {
  return (json.violations ?? []).map((v) => lead("pipeline-fuzz", v.rule, contractPath ?? json.contract ?? "api-contract.json", 0, `${v.case}: ${v.detail}`, v.severity));
}
