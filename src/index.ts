import {
  createLambdaFunction,
  createProbot,
} from "@probot/adapter-aws-lambda-serverless";
import app from "./app.js";

export const handler = createLambdaFunction(app, {
  probot: createProbot(),
});
