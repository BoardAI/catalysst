import { Probot, Context } from "probot";
import {
  getDeploymentFailureComment,
  getDeploymentStartedComment,
  getDeploymentSuccessComment,
} from "./comments.js";
import { loadConfig } from "./config.js";

const APP_ID = parseInt(getEnv("APP_ID"));

function getEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

function getRepoDetails(context: Context<"pull_request">) {
  return {
    owner: context.payload.repository.owner.login,
    repo: context.payload.repository.name,
    repoId: context.payload.repository.id,
  };
}

async function getOrUpdateComment(
  context: Context<"pull_request">,
  prNumber: number,
  body: string
) {
  const { owner, repo } = getRepoDetails(context);
  const comments = await context.octokit.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
  });

  const existingComment = comments.data.find(
    (comment) => comment.performed_via_github_app?.id === APP_ID
  );

  let commentId = existingComment?.id;

  if (!commentId) {
    const initialComment = await context.octokit.issues.createComment(
      context.issue({
        body,
      })
    );
    commentId = initialComment.data.id;
  } else {
    await context.octokit.issues.updateComment({
      owner,
      repo,
      comment_id: commentId,
      body,
    });
  }

  return commentId;
}

export default (app: Probot) => {
  /**
   * When a PR is opened or synchronized, trigger the deployment workflow.
   * This will create an environment, post a comment on the PR, and push to a transient stage.
   */
  app.on(
    ["pull_request.opened", "pull_request.synchronize"],
    async (context) => {
      const { owner, repo } = getRepoDetails(context);
      const pr = context.payload.pull_request;
      const ref = pr.head.ref;
      const stage = `pr-${pr.number}`;

      let checkRunId = undefined;

      try {
        const tableComment = await getDeploymentStartedComment(context, stage);

        // post a comment on the PR
        await getOrUpdateComment(context, pr.number, tableComment);

        // use stage as environment name
        await context.octokit.repos.createOrUpdateEnvironment({
          repo,
          owner,
          environment_name: stage,
        });
        app.log.info("Created or updated environment");

        // Create a check run to track the deployment status
        const checkRun = await context.octokit.checks.create({
          owner,
          repo,
          name: `SST - ${stage}`,
          head_sha: pr.head.sha,
          status: "in_progress",
          started_at: new Date().toISOString(),
          output: {
            title: "Deployment in Progress",
            summary: `Deployment to **${stage}** is in progress.`,
          },
        });

        app.log.info("Created check run");
        checkRunId = checkRun.data.id;

        // Trigger the GitHub Actions workflow
        await context.octokit.actions.createWorkflowDispatch({
          owner,
          repo,
          workflow_id: "sst",
          ref,
          inputs: {
            stage,
            action: "deploy",
          },
        });
      } catch (error) {
        console.log("error", error);
        app.log.error("Error triggering workflow:", error);

        // Update the check run to mark it as failed
        if (checkRunId) {
          await context.octokit.checks.update({
            owner,
            repo,
            check_run_id: checkRunId,
            status: "completed",
            conclusion: "failure",
            completed_at: new Date().toISOString(),
            output: {
              title: `SST - ${stage}`,
              summary: `Deployment to **${stage}** could not be started.`,
            },
          });
        }
      }
    }
  );

  app.on("deployment_status.created", async (context) => {
    const deployment = context.payload.deployment;
    const deploymentStatus = context.payload.deployment_status;
    const owner = context.payload.repository.owner.login;
    const repo = context.payload.repository.name;
    const stage = deployment.environment;
    const config = await loadConfig(context);

    const isPrDeployment = stage.startsWith("pr-");
    const isStaticEnv = Object.keys(config.branchMappings).includes(stage);

    /**
     * Check if the deployment status is success or failure and if it's a PR deployment.
     */
    if (
      !["success", "failure"].includes(deploymentStatus.state) ||
      !(isPrDeployment || isStaticEnv)
    ) {
      app.log.info("Ignoring deployment status created event.");
      return;
    }

    const res = await context.octokit.checks.listForRef({
      owner,
      repo,
      ref: deployment.sha,
      app_id: APP_ID,
    });

    const checkRun = res.data.check_runs.find(
      (c) => c.status === "in_progress"
    );

    if (isStaticEnv && checkRun) {
      // for static envs, just update the check run status
      if (deploymentStatus.state === "success") {
        await context.octokit.checks.update({
          owner,
          repo,
          check_run_id: checkRun.id,
          status: "completed",
          conclusion: "success",
          details_url: deploymentStatus.log_url,
          completed_at: new Date().toISOString(),
          output: {
            title: "Deployment Successful",
            summary: `Deployment to **${deployment.environment}** was successful.`,
          },
        });

        return;
      }

      if (deploymentStatus.state === "failure") {
        await context.octokit.checks.update({
          owner,
          repo,
          check_run_id: checkRun.id,
          status: "completed",
          conclusion: "failure",
          details_url: deploymentStatus.log_url,
          completed_at: new Date().toISOString(),
          output: {
            title: "Deployment Failed",
            summary: `Deployment to **${deployment.environment}** failed.`,
          },
        });

        return;
      }
    }

    const prNumber = stage.replace("pr-", "");
    const comments = await context.octokit.issues.listComments({
      owner,
      repo,
      issue_number: parseInt(prNumber),
    });

    const existingComment = comments.data.find(
      (comment) => comment.performed_via_github_app?.id === APP_ID
    );

    if (!existingComment || !checkRun) {
      app.log.info("No existing comment or check run found. Ignoring.");
      return;
    }

    const checkRunId = checkRun.id;
    const commentId = existingComment.id;

    if (deploymentStatus.state === "success") {
      // update check run status
      await context.octokit.checks.update({
        owner,
        repo,
        check_run_id: checkRunId,
        status: "completed",
        conclusion: "success",
        details_url: deploymentStatus.log_url,
        completed_at: new Date().toISOString(),
        output: {
          title: "Deployment Successful",
          summary: `Deployment to **${deployment.environment}** was successful.`,
        },
      });

      // get sst outputs
      const outputs = await context.octokit.actions.getEnvironmentVariable({
        owner,
        repo,
        environment_name: stage,
        name: "SST_OUTPUTS",
        repository_id: context.payload.repository.id,
      });

      const data = JSON.parse(outputs.data.value);
      const successComment = getDeploymentSuccessComment(stage, data.urls);

      await context.octokit.issues.updateComment({
        owner,
        repo,
        comment_id: commentId,
        body: successComment,
      });

      return;
    }

    if (deploymentStatus.state === "failure") {
      // update check run status
      await context.octokit.checks.update({
        owner,
        repo,
        check_run_id: checkRunId,
        status: "completed",
        conclusion: "failure",
        details_url: deploymentStatus.log_url,
        completed_at: new Date().toISOString(),
        output: {
          title: "Deployment Failed",
          summary: `Deployment to **${deployment.environment}** failed.`,
        },
      });

      const failureComment = await getDeploymentFailureComment(
        context,
        stage,
        deploymentStatus.log_url!
      );

      await context.octokit.issues.updateComment({
        owner,
        repo,
        comment_id: commentId,
        body: failureComment,
      });

      return;
    }
  });

  /**
   * When a PR is closed, delete the environment and trigger the workflow to remove resources.
   */
  app.on("pull_request.closed", async (context) => {
    const pr = context.payload.pull_request;
    const stage = `pr-${pr.number}`;

    const deployments = await context.octokit.repos.listDeployments({
      owner: context.payload.repository.owner.login,
      repo: context.payload.repository.name,
      environment: stage,
    });

    const deploymentId = deployments.data[0].id;
    if (!deploymentId) {
      app.log.info("No deployment found. Ignoring.");
      return;
    }

    const owner = context.payload.repository.owner.login;
    const repo = context.payload.repository.name;

    try {
      await context.octokit.repos.deleteAnEnvironment({
        owner,
        repo,
        environment_name: stage,
      });
      app.log.info("Deleted environment");
    } catch (e) {
      // ignore error if environment doesn't exist (deleted manually)
    }

    const config = await loadConfig(context);

    try {
      await context.octokit.actions.createWorkflowDispatch({
        owner,
        repo,
        workflow_id: config.workflowId,
        ref: config.defaultBranch, // original branch could be deleted (squash merge)
        inputs: {
          stage,
          action: "remove",
        },
      });

      app.log.info("Triggered workflow to destroy resources");
    } catch (error) {
      console.log("error", error);
      app.log.error("Error deleting environment:", error);
    }
  });

  /**
   * When a push event is triggered, check if the branch is a static environment branch.
   * If it is, trigger the deployment workflow.
   */
  app.on("push", async (context) => {
    const ref = context.payload.ref;
    const branch = ref.replace("refs/heads/", "");
    const config = await loadConfig(context);

    const staticBranches = Object.keys(config.branchMappings);

    if (!staticBranches.includes(branch)) {
      app.log.info("Not a static env branch. Ignoring.");
      return;
    }

    const owner = context.payload.repository.owner.login;
    const repo = context.payload.repository.name;
    const stage =
      config.branchMappings[branch as keyof typeof config.branchMappings];

    await context.octokit.actions.createWorkflowDispatch({
      owner,
      repo,
      workflow_id: config.workflowId,
      ref: ref,
      inputs: {
        stage,
        action: "deploy",
      },
    });

    // Create a check run to track the deployment status
    await context.octokit.checks.create({
      owner,
      repo,
      name: `SST - ${stage}`,
      head_sha: context.payload.after,
      status: "in_progress",
      started_at: new Date().toISOString(),
      output: {
        title: "Deployment in Progress",
        summary: `Deployment to **${stage}** is in progress.`,
      },
    });
  });
};
