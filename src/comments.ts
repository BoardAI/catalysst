import { format } from "date-fns/format";
import { config } from "./config.js";

export function getDeploymentFailureComment(stage: string, logsUrl: string) {
  const date = format(new Date(), "MMMM d, yyyy h:mmaaa");

  return `
❌ **Deployment Failed** for the **\`${stage}\`** stage.

| **Key**           | **Value**                                      |
|-------------------|------------------------------------------------|
| **View Logs**     | [Github Actions](${logsUrl})                   |
| **Console URL**   | https://console.sst.dev/${config.sstWorkspace} |
| **Updated at**    | ${date} (UTC)                                  |

> The deployment process failed. Please check the logs for more information.
`;
}

export function getDeploymentSuccessComment(
  stage: string,
  urls: Record<string, string | undefined>
) {
  // Helper functions to determine status and generate links
  const s = (url: string | undefined) => (url ? "✅" : "⏺️");
  const link = (url: string | undefined) =>
    url ? `[Visit Deployment](${url})` : "Deployment Not Available";

  // Generate dynamic table rows
  const tableRows = Object.entries(urls)
    .map(([name, url]) => `| **${name}** | ${s(url)} | ${link(url)} |`)
    .join("\n");

  // Return the final markdown comment
  return `
✅ **Deployment Successful** for the **\`${stage}\`** stage.

| **Name**              |  **Status**    |  **Value**         |
|-----------------------|----------------|--------------------|
${tableRows}
`;
}

export function getDeploymentStartedComment(stage: string) {
  const date = format(new Date(), "MMMM d, yyyy h:mmaaa");

  return `
🚀 **Deployment Triggered** for the **\`${stage}\`** stage.  

| **Key**           | **Value**                                      |
|-------------------|------------------------------------------------|
| **Stage**         | ${stage}                                       |
| **Console URL**   | https://console.sst.dev/${config.sstWorkspace} |
| **Updated at**    | ${date} (UTC)                                  |

> The deployment is in progress. The URLs will be updated here once available.
`;
}
