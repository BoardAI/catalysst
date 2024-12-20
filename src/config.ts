import { Context } from "probot";
import YAML from "yaml";
import merge from "lodash.merge"; // Install lodash with `npm install lodash`

const defaultConfig = {
  sstWorkspace: "procuro",
  defaultBranch: "feat/ci-cd-actions",
  workflowId: "sst.yml",
  branchMappings: {
    staging: "staging",
    main: "prod",
  },
};

export async function loadConfig(ctx: Context) {
  const possibleFilePaths = [
    "sst-config.yml",
    "sst-config.yaml",
    ".github/sst-config.yml",
    ".github/sst-config.yaml",
  ];

  let loadedConfig: Record<string, any> = {};

  // Find and parse the first valid configuration file
  for (const path of possibleFilePaths) {
    try {
      const content = await ctx.octokit.repos.getContent({
        ...ctx.repo(),
        path,
      });

      const decodedContent = Buffer.from(
        (content.data as any).content,
        "base64"
      ).toString("utf-8");

      loadedConfig = YAML.parse(decodedContent);
      break;
    } catch (error) {
      // Continue to the next path if the file isn't found
    }
  }

  // Merge the default config with the loaded config
  return merge({}, defaultConfig, loadedConfig);
}
