import { Annotations, Aws, CfnOutput, Duration, Fn, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as bedrock from "aws-cdk-lib/aws-bedrock";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { DockerImageAsset, Platform } from "aws-cdk-lib/aws-ecr-assets";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as ses from "aws-cdk-lib/aws-ses";
import type { Construct } from "constructs";
import type { HearthSecrets } from "./data-stack";
import { loadGuardrail } from "./guardrail";
import { REPO_ROOT } from "./paths";

export interface ServiceStackProps extends StackProps {
  readonly table: dynamodb.ITable;
  /** Secrets Manager secrets owned by DataStack (populated before the first service deploy). */
  readonly secrets: HearthSecrets;
  /** Inject RESEND_API_KEY (context `useResend`). Off by default: the server treats any non-empty value as a real key. */
  readonly useResend?: boolean;
  /** SES sender identity (context `senderEmail`). */
  readonly senderEmail: string;
  /** Also run the simulated Alexa+ host (apps/host-sim). Default true. */
  readonly hostSim?: boolean;
  /** Optional Bedrock model id handed to the host as HEARTH_BEDROCK_MODEL_ID. */
  readonly bedrockModelId?: string;
  /** Docker build context. Defaults to the repo root. */
  readonly repoRoot?: string;
}

interface ServiceSpec {
  readonly id: string;
  readonly route: string;
  readonly dockerfile: string;
  readonly port: number;
  readonly healthPath: string;
  readonly cpu: number;
  readonly memoryMiB: number;
  readonly priority: number;
}

const SPECS = {
  mcp: { id: "Mcp", route: "mcp", dockerfile: "apps/mcp-server/Dockerfile", port: 4200, healthPath: "/healthz", cpu: 512, memoryMiB: 1024, priority: 10 },
  auth: { id: "Auth", route: "auth", dockerfile: "apps/auth-server/Dockerfile", port: 4100, healthPath: "/.well-known/oauth-authorization-server", cpu: 256, memoryMiB: 512, priority: 20 },
  host: { id: "Host", route: "host", dockerfile: "apps/host-sim/Dockerfile", port: 3000, healthPath: "/", cpu: 512, memoryMiB: 1024, priority: 30 },
} satisfies Record<string, ServiceSpec>;

type ServiceKey = keyof typeof SPECS;

/**
 * Runs Hearth as three always-on Fargate services behind one ALB, each fronted by its own
 * CloudFront distribution (free HTTPS on *.cloudfront.net, no domain needed).
 *
 * Why this shape (see README "Why Fargate + ALB + CloudFront"): the three services need each
 * other's public URL in their environment (issuer, MCP base, host base). With App Runner the URL
 * only exists after the service does, which makes that a CloudFormation cycle. Here the ALB does
 * not depend on any service, the distributions depend only on the ALB, and the services depend
 * on the distributions, so everything resolves in one deploy.
 */
export class ServiceStack extends Stack {
  public readonly mcpBaseUrl: string;
  public readonly authIssuerUrl: string;
  public readonly hostBaseUrl: string | undefined;
  public readonly guardrail: bedrock.CfnGuardrail;
  public readonly guardrailVersion: bedrock.CfnGuardrailVersion;
  public readonly services: Partial<Record<ServiceKey, ecs.FargateService>> = {};

  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, props);
    const repoRoot = props.repoRoot ?? REPO_ROOT;
    const withHost = props.hostSim ?? true;

    // ------------------------------------------------------------------ SES
    new ses.EmailIdentity(this, "SenderIdentity", { identity: ses.Identity.email(props.senderEmail) });
    const identityArn = this.formatArn({ service: "ses", resource: "identity", resourceName: props.senderEmail });

    // ----------------------------------------------------------- guardrail
    const loaded = loadGuardrail(repoRoot);
    this.guardrail = new bedrock.CfnGuardrail(this, "Guardrail", {
      ...loaded.config,
      name: "hearth-safety",
    });
    // Versions are immutable snapshots: a new logical id (policy hash) is a new version.
    this.guardrailVersion = new bedrock.CfnGuardrailVersion(this, `GuardrailVersion${loaded.hash}`, {
      guardrailIdentifier: this.guardrail.attrGuardrailId,
      description: `policy ${loaded.hash} (${loaded.source})`,
    });
    Annotations.of(this).addInfo(`Guardrail policy source: ${loaded.source} (${loaded.hash})`);

    // -------------------------------------------------------------- network
    // Public subnets only: no NAT gateway (about $32/month each). Tasks get a public IP but their
    // security group only admits the ALB, and DynamoDB traffic stays on a free gateway endpoint.
    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [{ name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 }],
      gatewayEndpoints: { Dynamo: { service: ec2.GatewayVpcEndpointAwsService.DYNAMODB } },
    });
    const cluster = new ecs.Cluster(this, "Cluster", { vpc, clusterName: "hearth" });

    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", { vpc, internetFacing: true });
    const listener = alb.addListener("Http", {
      port: 80,
      open: true,
      defaultAction: elbv2.ListenerAction.fixedResponse(403, { contentType: "text/plain", messageBody: "forbidden" }),
    });
    // Defence in depth, not the auth boundary (OAuth is): the ALB only forwards requests that carry
    // the per-stack token CloudFront adds as an origin header. The header value also names the route.
    const originToken = Fn.select(2, Fn.split("/", Aws.STACK_ID));
    const originHeader = (spec: ServiceSpec) => Fn.join("-", [originToken, spec.route]);

    // ------------------------------------------------- distributions (first)
    const distributions: Partial<Record<ServiceKey, cloudfront.Distribution>> = {};
    const keys: ServiceKey[] = withHost ? ["mcp", "auth", "host"] : ["mcp", "auth"];
    for (const key of keys) {
      const spec: ServiceSpec = SPECS[key];
      distributions[key] = new cloudfront.Distribution(this, `${spec.id}Cdn`, {
        comment: `Hearth ${spec.route}`,
        priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
        httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
        defaultBehavior: {
          origin: new origins.HttpOrigin(alb.loadBalancerDnsName, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
            readTimeout: Duration.seconds(60),
            keepaliveTimeout: Duration.seconds(60),
            customHeaders: { "X-Hearth-Origin": originHeader(spec) },
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
          compress: false, // MCP uses text/event-stream; never buffer or recompress it
        },
      });
    }
    const baseUrl = (key: ServiceKey) => `https://${distributions[key]!.distributionDomainName}`;
    this.mcpBaseUrl = baseUrl("mcp");
    this.authIssuerUrl = baseUrl("auth");
    this.hostBaseUrl = withHost ? baseUrl("host") : undefined;

    // ------------------------------------------------------------- services
    const addService = (
      key: ServiceKey,
      opts: { env: Record<string, string>; secrets?: Record<string, ecs.Secret> },
    ): { service: ecs.FargateService; taskRole: iam.IRole } => {
      const spec: ServiceSpec = SPECS[key];
      const image = new DockerImageAsset(this, `${spec.id}Image`, {
        directory: repoRoot,
        file: spec.dockerfile,
        platform: Platform.LINUX_AMD64,
        exclude: ["**/cdk.out", ".git"],
      });
      const taskDef = new ecs.FargateTaskDefinition(this, `${spec.id}Task`, {
        cpu: spec.cpu,
        memoryLimitMiB: spec.memoryMiB,
        runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.X86_64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
      });
      taskDef.addContainer(spec.route, {
        image: ecs.ContainerImage.fromDockerImageAsset(image),
        portMappings: [{ containerPort: spec.port }],
        environment: { NODE_ENV: "production", PORT: String(spec.port), AWS_REGION: this.region, ...opts.env },
        secrets: opts.secrets,
        logging: ecs.LogDrivers.awsLogs({
          streamPrefix: spec.route,
          logGroup: new logs.LogGroup(this, `${spec.id}Logs`, { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY }),
        }),
        stopTimeout: Duration.seconds(30),
      });

      const service = new ecs.FargateService(this, `${spec.id}Service`, {
        cluster,
        taskDefinition: taskDef,
        serviceName: `hearth-${spec.route}`,
        // Always on: one task is permanently running, so there is no cold start. MCP sessions are
        // held in memory, so we do not scale out (README "Scaling and sessions").
        desiredCount: 1,
        minHealthyPercent: 100,
        maxHealthyPercent: 200,
        circuitBreaker: { rollback: true },
        assignPublicIp: true,
        vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
        healthCheckGracePeriod: Duration.seconds(90),
      });

      const group = new elbv2.ApplicationTargetGroup(this, `${spec.id}Targets`, {
        vpc,
        protocol: elbv2.ApplicationProtocol.HTTP,
        port: spec.port,
        targetType: elbv2.TargetType.IP,
        deregistrationDelay: Duration.seconds(30),
        healthCheck: { path: spec.healthPath, healthyHttpCodes: "200-399", interval: Duration.seconds(15), healthyThresholdCount: 2 },
      });
      group.addTarget(service);
      new elbv2.ApplicationListenerRule(this, `${spec.id}Rule`, {
        listener,
        priority: spec.priority,
        conditions: [elbv2.ListenerCondition.httpHeader("X-Hearth-Origin", [originHeader(spec)])],
        action: elbv2.ListenerAction.forward([group]),
      });

      this.services[key] = service;
      return { service, taskRole: taskDef.taskRole };
    };

    const hostBase = this.hostBaseUrl ?? "http://localhost:3000";

    // mcp-server
    const mcp = addService("mcp", {
      env: {
        HEARTH_MCP_BASE: this.mcpBaseUrl,
        HEARTH_AUTH_ISSUER: this.authIssuerUrl,
        HEARTH_DDB_TABLE: props.table.tableName,
        HEARTH_EMAIL_FROM: `Hearth <${props.senderEmail}>`,
      },
      secrets: {
        STRIPE_SECRET_KEY: ecs.Secret.fromSecretsManager(props.secrets.stripe),
        ...(props.useResend ? { RESEND_API_KEY: ecs.Secret.fromSecretsManager(props.secrets.resend) } : {}),
      },
    });
    props.table.grantReadWriteData(mcp.taskRole);
    mcp.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({ sid: "SendConfirmationEmail", actions: ["ses:SendEmail", "ses:SendRawEmail"], resources: [identityArn] }),
    );

    // auth-server
    addService("auth", {
      env: {
        HEARTH_AUTH_ISSUER: this.authIssuerUrl,
        HEARTH_MCP_BASE: this.mcpBaseUrl,
        HEARTH_HOST_BASE: hostBase,
      },
      // Read by the auth server when it supports it; otherwise it generates its own key at boot.
      secrets: { HEARTH_AUTH_PRIVATE_JWK: ecs.Secret.fromSecretsManager(props.secrets.authJwk) },
    });

    // host-sim
    if (withHost) {
      const host = addService("host", {
        env: {
          HEARTH_MCP_BASE: this.mcpBaseUrl,
          HEARTH_AUTH_ISSUER: this.authIssuerUrl,
          HEARTH_HOST_BASE: hostBase,
          HEARTH_GUARDRAIL_ID: this.guardrail.attrGuardrailId,
          HEARTH_GUARDRAIL_VERSION: this.guardrailVersion.attrVersion,
          HOSTNAME: "0.0.0.0",
          ...(props.bedrockModelId ? { HEARTH_BEDROCK_MODEL_ID: props.bedrockModelId } : {}),
        },
      });
      host.taskRole.addToPrincipalPolicy(
        new iam.PolicyStatement({
          sid: "InvokeBedrockModels",
          actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
          // Cross-region inference profiles route to foundation models in other regions.
          resources: [
            "arn:aws:bedrock:*::foundation-model/*",
            this.formatArn({ service: "bedrock", resource: "inference-profile", resourceName: "*" }),
          ],
        }),
      );
      host.taskRole.addToPrincipalPolicy(
        new iam.PolicyStatement({ sid: "ApplyGuardrail", actions: ["bedrock:ApplyGuardrail"], resources: [this.guardrail.attrGuardrailArn] }),
      );
      host.taskRole.addToPrincipalPolicy(
        // Polly has no resource-level permissions.
        new iam.PolicyStatement({ sid: "SpeakWithPolly", actions: ["polly:SynthesizeSpeech"], resources: ["*"] }),
      );
    }

    // -------------------------------------------------------------- outputs
    new CfnOutput(this, "McpUrl", { value: `${this.mcpBaseUrl}/mcp`, description: "Public HTTPS MCP endpoint (Streamable HTTP)" });
    new CfnOutput(this, "AuthIssuerUrl", { value: this.authIssuerUrl, description: "OAuth issuer (HEARTH_AUTH_ISSUER)" });
    new CfnOutput(this, "TableName", { value: props.table.tableName, description: "DynamoDB table (HEARTH_DDB_TABLE)" });
    new CfnOutput(this, "GuardrailId", { value: this.guardrail.attrGuardrailId });
    new CfnOutput(this, "GuardrailVersion", { value: this.guardrailVersion.attrVersion });
    new CfnOutput(this, "SenderIdentityArn", { value: identityArn, description: `Verify ${props.senderEmail} in SES before sending` });
    if (this.hostBaseUrl) new CfnOutput(this, "HostSimUrl", { value: this.hostBaseUrl });
  }
}
