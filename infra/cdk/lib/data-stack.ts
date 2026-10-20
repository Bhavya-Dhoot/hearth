import { CfnOutput, RemovalPolicy, SecretValue, Stack, type StackProps } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";

export interface HearthSecrets {
  readonly stripe: secretsmanager.ISecret;
  readonly resend: secretsmanager.ISecret;
  readonly authJwk: secretsmanager.ISecret;
}

/**
 * Home Graph single table (PRD section 8). Keys are generic (PK, SK) so every entity
 * (Home, Asset, Issue, Order, Event) shares one table; GSI1 serves access patterns that
 * invert the primary key (for example "all homes for a user" or "events by day").
 */
export class DataStack extends Stack {
  public readonly table: dynamodb.Table;
  public readonly secrets: HearthSecrets;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.table = new dynamodb.Table(this, "HomeGraph", {
      tableName: "hearth-home-graph",
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.table.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: { name: "GSI1PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI1SK", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Placeholders only: real values are written out of band (README "Secrets"), which is why the
    // secrets live here and not in ServiceStack: deploy this stack, fill them, then deploy services.
    const placeholder = SecretValue.unsafePlainText("REPLACE_ME");
    const secret = (logicalId: string, secretName: string, description: string) =>
      new secretsmanager.Secret(this, logicalId, {
        secretName,
        description,
        secretStringValue: placeholder,
        removalPolicy: RemovalPolicy.DESTROY,
      });
    this.secrets = {
      stripe: secret("StripeSecret", "hearth/STRIPE_SECRET_KEY", "Stripe test-mode secret key (sk_test_...)"),
      resend: secret("ResendSecret", "hearth/RESEND_API_KEY", "Resend API key (confirmation email in dev)"),
      authJwk: secret("AuthJwkSecret", "hearth/HEARTH_AUTH_PRIVATE_JWK", "RS256 private JWK (JSON) for the auth server; see scripts/gen-auth-jwk.mjs"),
    };

    new CfnOutput(this, "TableName", {
      value: this.table.tableName,
      description: "DynamoDB Home Graph table (HEARTH_DDB_TABLE)",
    });
  }
}
