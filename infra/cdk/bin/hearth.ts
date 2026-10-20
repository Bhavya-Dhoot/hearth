#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { AgentCoreStack } from "../lib/agentcore-stack";
import { DataStack } from "../lib/data-stack";
import { ServiceStack } from "../lib/service-stack";

const app = new App();
const flag = (key: string, fallback: boolean): boolean => {
  const v = app.node.tryGetContext(key);
  return v === undefined ? fallback : String(v) !== "false";
};
const text = (key: string): string | undefined => {
  const v = app.node.tryGetContext(key);
  return v === undefined || v === "" ? undefined : String(v);
};

// Env-agnostic unless the CLI resolved an account (so `cdk synth` works with no credentials).
const env =
  process.env.CDK_DEFAULT_ACCOUNT && process.env.CDK_DEFAULT_REGION
    ? { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }
    : undefined;

const data = new DataStack(app, "HearthData", { env });

const service = new ServiceStack(app, "HearthService", {
  env,
  table: data.table,
  secrets: data.secrets,
  useResend: flag("useResend", false),
  senderEmail: text("senderEmail") ?? "hearth-noreply@example.com",
  hostSim: flag("hostSim", true),
  bedrockModelId: text("bedrockModelId"),
});

if (flag("agentcore", false)) {
  new AgentCoreStack(app, "HearthAgentCore", {
    env,
    table: data.table,
    authIssuerUrl: service.authIssuerUrl,
    discoveryUrl: text("agentcoreDiscoveryUrl"),
    allowedClients: text("agentcoreAllowedClients")?.split(","),
    allowedAudience: text("agentcoreAllowedAudience")?.split(","),
  });
}
