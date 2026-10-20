import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";
import { AgentCoreStack } from "../lib/agentcore-stack";
import { DataStack } from "../lib/data-stack";
import { DEFAULT_GUARDRAIL, loadGuardrail } from "../lib/guardrail";
import { ServiceStack } from "../lib/service-stack";

let data: Template;
let service: Template;
let agentcore: Template;

beforeAll(() => {
  const app = new App();
  const dataStack = new DataStack(app, "HearthData");
  const serviceStack = new ServiceStack(app, "HearthService", {
    table: dataStack.table,
    secrets: dataStack.secrets,
    useResend: false,
    senderEmail: "hello@hearth.test",
    hostSim: true,
  });
  const agentcoreStack = new AgentCoreStack(app, "HearthAgentCore", {
    table: dataStack.table,
    authIssuerUrl: serviceStack.authIssuerUrl,
  });
  data = Template.fromStack(dataStack);
  service = Template.fromStack(serviceStack);
  agentcore = Template.fromStack(agentcoreStack);
}, 120_000);

describe("DataStack", () => {
  it("defines the single table with PK/SK, GSI1, on-demand billing and PITR", () => {
    data.hasResourceProperties("AWS::DynamoDB::Table", {
      TableName: "hearth-home-graph",
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
      BillingMode: "PAY_PER_REQUEST",
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
      GlobalSecondaryIndexes: [
        Match.objectLike({
          IndexName: "GSI1",
          KeySchema: [
            { AttributeName: "GSI1PK", KeyType: "HASH" },
            { AttributeName: "GSI1SK", KeyType: "RANGE" },
          ],
        }),
      ],
    });
  });

  it("retains the table on stack deletion", () => {
    data.hasResource("AWS::DynamoDB::Table", { DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain" });
  });

  it("outputs the table name", () => {
    expect(Object.keys(data.findOutputs("TableName"))).toEqual(["TableName"]);
  });
});

describe("ServiceStack", () => {
  it("runs mcp-server, auth-server and host-sim as always-on Fargate services (min 1 task, no cold start)", () => {
    service.resourceCountIs("AWS::ECS::Service", 3);
    for (const name of ["hearth-mcp", "hearth-auth", "hearth-host"]) {
      service.hasResourceProperties("AWS::ECS::Service", {
        ServiceName: name,
        LaunchType: "FARGATE",
        DesiredCount: 1,
        DeploymentConfiguration: Match.objectLike({ MinimumHealthyPercent: 100 }),
      });
    }
  });

  it("does not let the service count drop to zero via autoscaling", () => {
    service.resourceCountIs("AWS::ApplicationAutoScaling::ScalableTarget", 0);
  });

  it("wires cross-references: issuer and MCP base are CloudFront URLs, table is the DynamoDB table", () => {
    const tasks = service.findResources("AWS::ECS::TaskDefinition");
    const blobs = Object.values(tasks).map((t) => JSON.stringify(t.Properties.ContainerDefinitions[0].Environment));
    expect(blobs).toHaveLength(3);
    const mcp = blobs.find((b) => b.includes("HEARTH_DDB_TABLE"))!;
    expect(mcp).toContain("HEARTH_MCP_BASE");
    expect(mcp).toContain("HEARTH_AUTH_ISSUER");
    expect(mcp).toContain("McpCdn");
    expect(mcp).toContain("AuthCdn");
    const auth = blobs.find((b) => b.includes("HEARTH_HOST_BASE") && !b.includes("HEARTH_GUARDRAIL_ID"))!;
    expect(auth).toContain("HEARTH_AUTH_ISSUER");
    expect(auth).toContain("HEARTH_MCP_BASE");
    expect(auth).toContain("HostCdn");
  });

  it("injects the three secrets from Secrets Manager, never as plain environment values", () => {
    data.resourceCountIs("AWS::SecretsManager::Secret", 3);
    for (const name of ["hearth/STRIPE_SECRET_KEY", "hearth/RESEND_API_KEY", "hearth/HEARTH_AUTH_PRIVATE_JWK"]) {
      data.hasResourceProperties("AWS::SecretsManager::Secret", { Name: name });
    }
    const defs = Object.values(service.findResources("AWS::ECS::TaskDefinition")).map((t) => t.Properties.ContainerDefinitions[0]);
    const secretNames = defs.flatMap((d) => (d.Secrets ?? []).map((s: { Name: string }) => s.Name)).sort();
    expect(secretNames).toEqual(["HEARTH_AUTH_PRIVATE_JWK", "STRIPE_SECRET_KEY"]); // RESEND_API_KEY only with useResend
    const envNames = defs.flatMap((d) => (d.Environment ?? []).map((e: { Name: string }) => e.Name));
    for (const name of secretNames) expect(envNames).not.toContain(name);
  });

  it("creates the Bedrock guardrail denying every hard-stop topic, plus a version", () => {
    // Works for both policy sources: the safety agent's JSON file or the built-in default.
    const [guardrail] = Object.values(service.findResources("AWS::Bedrock::Guardrail"));
    expect(guardrail?.Properties.Name).toBe("hearth-safety");
    const topics: Array<{ Name: string; Type: string }> = guardrail?.Properties.TopicPolicyConfig.TopicsConfig;
    for (const topic of [/gas/i, /electrical/i, /structural/i, /sewage/i, /children/i]) {
      const match = topics.find((x) => topic.test(x.Name));
      expect(match, String(topic)).toBeDefined();
      expect(match?.Type).toBe("DENY");
    }
    expect(guardrail?.Properties.BlockedInputMessaging).toBeTruthy();
    expect(guardrail?.Properties.BlockedOutputsMessaging).toBeTruthy();
    service.resourceCountIs("AWS::Bedrock::GuardrailVersion", 1);
  });

  it("verifies an SES identity for the sender email", () => {
    service.hasResourceProperties("AWS::SES::EmailIdentity", { EmailIdentity: "hello@hearth.test" });
  });

  it("outputs the MCP URL (ending in /mcp), auth issuer, table name and guardrail id/version", () => {
    for (const name of ["McpUrl", "AuthIssuerUrl", "TableName", "GuardrailId", "GuardrailVersion"]) {
      expect(Object.keys(service.findOutputs(name)), name).toEqual([name]);
    }
    expect(JSON.stringify(service.findOutputs("McpUrl").McpUrl?.Value)).toContain("/mcp");
  });

  it("fronts every service with an HTTPS-only CloudFront distribution that never caches", () => {
    service.resourceCountIs("AWS::CloudFront::Distribution", 3);
    service.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: "redirect-to-https", Compress: false }),
      }),
    });
  });
});

describe("least privilege", () => {
  const statements = (t: Template) =>
    Object.values(t.findResources("AWS::IAM::Policy")).flatMap((p) => {
      const s = p.Properties.PolicyDocument.Statement;
      return Array.isArray(s) ? s : [s];
    });
  const asArray = <T>(v: T | T[]): T[] => (Array.isArray(v) ? v : [v]);

  it("never grants dynamodb:* or any wildcard action", () => {
    for (const t of [service, agentcore]) {
      for (const s of statements(t)) {
        for (const action of asArray<string>(s.Action)) {
          expect(action).not.toBe("*");
          expect(action).not.toMatch(/^dynamodb:\*$/);
          expect(action).not.toMatch(/^(bedrock|ses|secretsmanager):\*$/);
        }
      }
    }
  });

  it("grants DynamoDB actions only on the table and GSI, never on *", () => {
    const ddb = statements(service).filter((s) => asArray<string>(s.Action).some((a) => a.startsWith("dynamodb:")));
    expect(ddb.length).toBeGreaterThan(0);
    for (const s of ddb) expect(JSON.stringify(s.Resource)).not.toBe('"*"');
  });

  it("scopes ApplyGuardrail to the guardrail and SendEmail to the SES identity", () => {
    const apply = statements(service).find((s) => asArray<string>(s.Action).includes("bedrock:ApplyGuardrail"))!;
    expect(JSON.stringify(apply.Resource)).toContain("Guardrail");
    const send = statements(service).find((s) => asArray<string>(s.Action).includes("ses:SendEmail"))!;
    expect(JSON.stringify(send.Resource)).toContain("hello@hearth.test");
    const invoke = statements(service).find((s) => asArray<string>(s.Action).includes("bedrock:InvokeModel"))!;
    expect(JSON.stringify(invoke.Resource)).toContain("foundation-model");
  });
});

describe("AgentCoreStack", () => {
  it("deploys the mcp-server image as an MCP-protocol AgentCore Runtime with a container artifact", () => {
    agentcore.hasResourceProperties("AWS::BedrockAgentCore::Runtime", {
      ProtocolConfiguration: "MCP",
      AgentRuntimeArtifact: { ContainerConfiguration: { ContainerUri: Match.anyValue() } },
      NetworkConfiguration: { NetworkMode: "PUBLIC" },
    });
  });

  it("adds AgentCore Memory for home-graph recall and outputs the MCP URL", () => {
    agentcore.resourceCountIs("AWS::BedrockAgentCore::Memory", 1);
    expect(Object.keys(agentcore.findOutputs("AgentCoreMcpUrl"))).toEqual(["AgentCoreMcpUrl"]);
  });
});

describe("guardrail loader", () => {
  it("falls back to the built-in default when the safety agent has not written a policy yet", () => {
    const loaded = loadGuardrail("/nonexistent-repo-root");
    expect(loaded.source).toBe("default");
    expect(loaded.config).toEqual(DEFAULT_GUARDRAIL);
    expect(loaded.hash).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("guardrail loader with a policy file", () => {
  it("uses packages/playbooks/safety/bedrock-guardrail.json when present and fills missing messaging", () => {
    const root = mkdtempSync(join(tmpdir(), "hearth-guardrail-"));
    try {
      mkdirSync(join(root, "packages", "playbooks", "safety"), { recursive: true });
      const topics = [{ name: "Only topic", type: "DENY", definition: "d", examples: ["e"] }];
      writeFileSync(
        join(root, "packages", "playbooks", "safety", "bedrock-guardrail.json"),
        JSON.stringify({ topicPolicyConfig: { topicsConfig: topics } }),
      );
      const loaded = loadGuardrail(root);
      expect(loaded.source).toBe("file");
      expect(loaded.config.topicPolicyConfig).toEqual({ topicsConfig: topics });
      expect(loaded.config.blockedInputMessaging).toBe(DEFAULT_GUARDRAIL.blockedInputMessaging);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
