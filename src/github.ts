/**
 * Trigger a GitHub Actions workflow_dispatch.
 * Needs GITHUB_TOKEN or GH_TOKEN with `actions: write` on the repo.
 */

export type TriggerOptions = {
  repo: string; // owner/name
  workflow: string; // file name e.g. sync-notion.yml
  ref?: string;
  token?: string;
};

export type TriggerResult = {
  ok: boolean;
  status: number;
  message: string;
};

export async function triggerWorkflow(
  opts: TriggerOptions,
): Promise<TriggerResult> {
  const token =
    opts.token?.trim() ||
    process.env.GITHUB_TOKEN?.trim() ||
    process.env.GH_TOKEN?.trim();

  if (!token) {
    return {
      ok: false,
      status: 0,
      message: "Missing GITHUB_TOKEN or GH_TOKEN",
    };
  }

  const match = opts.repo.match(/^([^/]+)\/([^/]+)$/);
  if (!match) {
    return {
      ok: false,
      status: 0,
      message: `Invalid --repo (expected owner/name): ${opts.repo}`,
    };
  }

  const [, owner, repo] = match;
  const ref = opts.ref?.trim() || "main";
  const workflow = opts.workflow.trim();

  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "notion-static-exporter",
    },
    body: JSON.stringify({ ref }),
  });

  if (res.status === 204) {
    return {
      ok: true,
      status: 204,
      message: `Dispatched ${workflow} on ${owner}/${repo}@${ref}`,
    };
  }

  const body = await res.text();
  return {
    ok: false,
    status: res.status,
    message: body || res.statusText || `HTTP ${res.status}`,
  };
}
