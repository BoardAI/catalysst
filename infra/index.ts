const fn = new sst.aws.Function("WebhooksHandler", {
  handler: "src/index.handler",
  environment: {
    APP_ID: process.env.APP_ID!,
    PRIVATE_KEY: process.env.PRIVATE_KEY!,
    WEBHOOK_SECRET: process.env.WEBHOOK_SECRET!,
  },
  nodejs: {
    install: ["probot", "@probot/adapter-aws-lambda-serverless", "date-fns"],
    format: "cjs",
  },
  memory: "2048 MB",
});

const api = new sst.aws.ApiGatewayV2("WebhooksApi");

api.route("POST /{proxy+}", fn.arn);

export {};