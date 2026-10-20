import { CfnOutput, Duration, Fn, Stack, type StackProps } from "aws-cdk-lib";
import * as agentcore from "aws-cdk-lib/aws-bedrockagentcore";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import type { Construct } from "constructs";
import { REPO_ROOT } from "./paths";

export interface AgentCoreStackProps extends StackProps {
  readonly table: dynamodb.ITable;
  /** Auth issuer from ServiceStack (HEARTH_AUTH_ISSUER). */
  readonly authIssuerUrl: string;
  /**
   * Context `agentcoreDiscoveryUrl`. AgentCore only accepts a URL ending in
   * /.well-known/openid-configuration. When omitted the runtime uses IAM (SigV4) inbound auth.
   */
  readonly discoveryUrl?: string;
  readonly allowedClients?: string[];
  readonly allowedAudience?: string[];
  readonly repoRoot?: string;
}

/**
 * Optional (context `agentcore=true`): the same mcp-server image as an AgentCore Runtime with
 * protocol MCP, plus an AgentCore Memory store for home-graph recall. Verified contract
 * (AWS docs, runtime-mcp-protocol-contract): ARM64 image, 0.0.0.0:8000, path /mcp, Streamable HTTP.
 */
export class AgentCoreStack extends Stack {
  public readonly runtime: agentcore.Runtime;
  public readonly memory: agentcore.Memory;

  constructor(scope: Construct, id: string, props: AgentCoreStackProps) {
    super(scope, id, props);

    this.memory = new agentcore.Memory(this, "HomeRecall", {
      memoryName: "hearth_home_recall",
      description: "Per-household recall: preferences and facts from earlier conversations",
      expirationDuration: Duration.days(90),
      memoryStrategies: [agentcore.MemoryStrategy.usingBuiltInSemantic(), agentcore.MemoryStrategy.usingBuiltInUserPreference()],
    });

    this.runtime = new agentcore.Runtime(this, "McpRuntime", {
      runtimeName: "hearth_mcp",
      description: "Hearth MCP server (home graph, repair playbooks, checkout)",
      protocolConfiguration: agentcore.ProtocolType.MCP,
      agentRuntimeArtifact: agentcore.AgentRuntimeArtifact.fromAsset(props.repoRoot ?? REPO_ROOT, {
        file: "apps/mcp-server/Dockerfile",
        platform: Platform.LINUX_ARM64, // AgentCore Runtime only runs ARM64 containers
        exclude: ["**/cdk.out", ".git"],
      }),
      authorizerConfiguration: props.discoveryUrl
        ? agentcore.RuntimeAuthorizerConfiguration.usingJWT(props.discoveryUrl, props.allowedClients, props.allowedAudience)
        : agentcore.RuntimeAuthorizerConfiguration.usingIAM(),
      environmentVariables: {
        NODE_ENV: "production",
        PORT: "8000", // AgentCore MCP contract; the server must honour PORT (README)
        HEARTH_DDB_TABLE: props.table.tableName,
        HEARTH_AUTH_ISSUER: props.authIssuerUrl,
        HEARTH_AGENTCORE_MEMORY_ID: this.memory.memoryId,
      },
    });
    props.table.grantReadWriteData(this.runtime);
    this.memory.grantRead(this.runtime);
    this.memory.grantWrite(this.runtime);

    const region = Stack.of(this).region;
    const encodedArn = Fn.join("", [
      "arn%3Aaws%3Abedrock-agentcore%3A", region, "%3A", Stack.of(this).account, "%3Aruntime%2F", this.runtime.agentRuntimeId,
    ]);
    new CfnOutput(this, "AgentRuntimeArn", { value: this.runtime.agentRuntimeArn });
    new CfnOutput(this, "AgentCoreMcpUrl", {
      value: Fn.join("", ["https://bedrock-agentcore.", region, ".amazonaws.com/runtimes/", encodedArn, "/invocations?qualifier=DEFAULT"]),
      description: "MCP endpoint of the AgentCore variant (SigV4 or bearer, depending on authorizer)",
    });
    new CfnOutput(this, "AgentCoreMemoryId", { value: this.memory.memoryId });
  }
}
