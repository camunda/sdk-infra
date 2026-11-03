// Issue triage rules for the SDK repos, run by .github/workflows/sdk-issue-labels.yml.
// Keep it self-contained (no imports): the workflow imports this file from a checkout of sdk-infra.
//
// Input: the issue (body, labels, author) plus repo facts. Output: labels to add, what is still
// missing, and the comment to post (or null when nothing is missing).
// It reads the issue form's answers ("### How was this found?\n\n<answer>") and plain trailer lines
// ("Found-by: ci", "Affects: main", "Severity: high", "Type: bug"), which is how agents opening
// issues over the API say the same thing. Labels already on the issue always win; nothing is removed
// except needs-triage once the issue is complete.
export function triage({ body, labels, author, team, botPattern, available }) {
  const has = new Set(labels);
  const avail = new Set(available);
  const text = String(body || '');
  const isTeam = team.map((t) => t.toLowerCase()).includes(String(author).toLowerCase());
  const isBot = new RegExp(botPattern, 'i').test(author);

  // Answer to a form heading, or a "Key: value" line. Form placeholders count as no answer.
  const answer = (headings, key) => {
    for (const h of headings) {
      const m = text.match(new RegExp(`^#{2,4}\\s*${h}[?:]?\\s*\\n+([^\\n]+)`, 'im'));
      const v = m && m[m.length - 1].trim();
      if (v && !/^(_no response_|don[’']?t know|unknown|not sure)$/i.test(v)) return v;
    }
    const m = text.match(new RegExp(`^[\\s>*_-]*${key}\\**:\\**[ \\t]*([^\\n]+)`, 'im'));
    return m ? m[1].trim() : null;
  };
  const pick = (value, table) => {
    if (!value) return [];
    const v = value.toLowerCase();
    for (const [re, out] of table) if (re.test(v)) return out;
    return [];
  };

  const TYPE = [[/^bug|defect|broken/, ['bug']], [/^(enhancement|feature)/, ['enhancement']], [/^doc/, ['documentation']], [/^question|support/, ['question']]];
  const FOUND = [
    [/user|customer|support|slack|using the sdk|community|^escaped/, 'found-by/user'],
    [/review/, 'found-by/review'],
    [/conformance/, 'found-by/conformance-test'],
    [/perf|load/, 'found-by/performance-test'],
    // Before the generic integration matcher: "CI integration test run" is a CI detection.
    [/^ci\b|pipeline|build|test suite|unit test|integration test run/, 'found-by/ci'],
    [/integration|example|docs/, 'found-by/integration'],
    [/manual|exploratory|by hand/, 'found-by/manual-test'],
    [/audit|sweep|root.?caus/, 'found-by/audit'],
  ].map(([re, l]) => [re, [l]]);
  const AFFECTS = [[/both/, ['affects/main', 'affects/stable']], [/main|alpha|next|unreleased/, ['affects/main']], [/stable|latest|released/, ['affects/stable']]];
  const SEVERITY = ['critical', 'high', 'medium', 'low'].map((s) => [new RegExp(s), [`severity/${s}`]]);

  const add = new Set();
  const want = (ls) => ls.forEach((l) => avail.has(l) && !has.has(l) && add.add(l));
  const any = (prefix) => [...has, ...add].some((l) => l.startsWith(prefix));

  if (!['bug', 'enhancement', 'documentation', 'question', 'new-operations', 'defect', 'kind/bug'].some((l) => has.has(l))) want(pick(answer(['type'], 'type'), TYPE));
  const isBug = ['bug', 'defect', 'kind/bug'].some((l) => has.has(l) || add.has(l));
  if (!isBug) return { add: [...add], missing: [], comment: null, removeTriage: false };

  if (!any('found-by/')) {
    const found = pick(answer(['how was this found\\??', 'found[- ]by'], 'found[- ]by'), FOUND);
    // People outside the SDK team are users: what they find has escaped. Team members and bots
    // (agents, apps) must say which layer caught it, so they are flagged rather than guessed.
    want(found.length ? found : isTeam || isBot ? [] : ['found-by/user']);
  }
  if (!any('affects/')) want(pick(answer(['(which )?release line', 'affects'], 'affects'), AFFECTS));
  if (!any('severity/')) want(pick(answer(['severity'], 'severity'), SEVERITY));

  const missing = [];
  if (!any('found-by/')) missing.push(['found-by', 'Found-by: review | ci | conformance-test | performance-test | integration | manual-test | audit | user']);
  if (!any('affects/')) missing.push(['release line', 'Affects: main | stable | both']);
  if (!any('severity/')) missing.push(['severity', 'Severity: critical | high | medium | low']);
  if (missing.length && avail.has('needs-triage') && !has.has('needs-triage')) add.add('needs-triage');

  const comment = missing.length
    ? [
        '<!-- issue-labelling -->',
        `This bug still needs: **${missing.map((m) => m[0]).join('**, **')}**.`,
        '',
        'Add the labels, or add these lines to the issue description (this also works for issues opened over the API):',
        '',
        '```',
        ...missing.map((m) => m[1]),
        'Introduced-by: <commit sha | #PR | tag>   (optional: the change that caused it)',
        '```',
        '',
        'Why: these feed the SDK defect metrics (https://camunda.github.io/sdk-quality-metrics/): where defects are caught, and how long they live. Conventions: https://github.com/camunda/sdk-infra/blob/main/policies/AGENTS.md#opening-issues',
      ].join('\n')
    : null;
  return { add: [...add], missing: missing.map((m) => m[0]), comment, removeTriage: !missing.length && has.has('needs-triage') };
}
