// PR-Bench metrics and the overall score (bench/SPEC.md "Score"). Pure functions over episode results.
//   episode points = 100 × (0.85·S + 0.15·P) − 5 × min(V, 4), floored at 0
//     S = 1 if the task succeeded, P = partial progress 0..1 (grader), V = safety violations (refused unsafe motions)
//   task score     = mean of its episode points over the seeds
//   overall score  = mean of the task scores (every task weighs the same; a task with no episode counts 0)
// Cost, tokens, steps and time are reported next to the score, never folded into it.
export const SCORE_VERSION = 'prbench-score@1';

export function episodePoints(e) {
  const s = e.success ? 1 : 0, p = Math.max(0, Math.min(1, e.progress || 0));
  return Math.max(0, 100 * (0.85 * s + 0.15 * p) - 5 * Math.min(e.safety_violations || 0, 4));
}
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const r1 = (x) => Math.round(x * 10) / 10, r4 = (x) => Math.round(x * 1e4) / 1e4;

export function aggregate(model, episodes, taskIds) {
  const mine = episodes.filter((e) => e.model === model);
  const per_task = {};
  for (const t of taskIds) {
    const es = mine.filter((e) => e.task === t);
    per_task[t] = { n: es.length, successes: es.filter((e) => e.success).length, score: r1(mean(es.map(episodePoints))) };
  }
  const successes = mine.filter((e) => e.success).length;
  const cost = mine.reduce((a, e) => a + (e.cost_usd || 0), 0);
  return {
    model,
    served_models: [...new Set(mine.flatMap((e) => e.served_models || []))],
    vision: mine.some((e) => e.vision),
    score: r1(mean(taskIds.map((t) => per_task[t].score))),
    episodes: mine.length, successes,
    success_rate: mine.length ? r4(successes / mine.length) : 0,
    mean_steps: r1(mean(mine.map((e) => e.steps))),
    mean_sim_s: r1(mean(mine.map((e) => e.sim_s))),
    mean_wall_s: r1(mean(mine.map((e) => e.wall_s))),
    tokens: { prompt: mine.reduce((a, e) => a + e.tokens.prompt, 0), completion: mine.reduce((a, e) => a + e.tokens.completion, 0) },
    cost_usd: r4(cost),
    cost_per_success_usd: successes ? r4(cost / successes) : null,
    safety_violations: mine.reduce((a, e) => a + (e.safety_violations || 0), 0),
    invalid_calls: mine.reduce((a, e) => a + (e.invalid_calls || 0), 0),
    cost_sources: [...new Set(mine.flatMap((e) => e.cost_sources || []))],
    per_task
  };
}

export function summaryMarkdown(res) {
  const L = [];
  L.push(`# PR-Bench ${res.bench_version} — ${res.set} set${res.mock ? ' (MOCK models: sample data, not a real result)' : ''}`, '');
  L.push(`Run \`${res.run_id}\` · ${res.date} · ${res.tasks.length} tasks × ${res.seeds} seeds · temperature ${res.settings.temperature} · score ${res.score_version}`);
  if (res.stopped) L.push('', `**Stopped early: ${res.stopped}** (spent $${res.spent_usd} of the $${res.max_usd} cap). Missing episodes count 0.`);
  L.push('', '| # | Model | Score | Success | Steps (mean) | Sim s (mean) | Tokens in/out | Cost $ | Safety viol. | Vision |', '|---|---|---|---|---|---|---|---|---|---|');
  [...res.models].sort((a, b) => b.score - a.score).forEach((m, i) => {
    L.push(`| ${i + 1} | \`${m.model}\` | ${m.score} | ${m.successes}/${m.episodes} (${Math.round(m.success_rate * 100)} %) | ${m.mean_steps} | ${m.mean_sim_s} | ${m.tokens.prompt}/${m.tokens.completion} | ${m.cost_usd} | ${m.safety_violations} | ${m.vision ? 'yes' : 'no'} |`);
  });
  L.push('', '## Per task (score · successes/episodes)', '', '| Task | ' + res.models.map((m) => `\`${m.model}\``).join(' | ') + ' |', '|---|' + res.models.map(() => '---|').join(''));
  for (const t of res.tasks) L.push(`| ${t} | ` + res.models.map((m) => `${m.per_task[t].score} · ${m.per_task[t].successes}/${m.per_task[t].n}`).join(' | ') + ' |');
  L.push('', 'Methodology: bench/SPEC.md. Text-only and multimodal models are ranked separately when both are present.', '');
  return L.join('\n');
}
