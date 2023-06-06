import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as log from 'aws-cdk-lib/aws-logs';
import * as customResources from 'aws-cdk-lib/custom-resources';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

import { createHash } from 'crypto';

export interface CdkResourceInitializerProps {
  fnMemorySize?: number,
  fnCode: lambda.DockerImageCode,
  fnTimeout: cdk.Duration,
  vpc: ec2.IVpc,
  subnetsSelection: ec2.SubnetSelection,
  fnSecurityGroups: ec2.ISecurityGroup[],
  fnLogRetention: log.RetentionDays,
  endpoint: string,
  databaseName: string,
  dbSecretArn: string
}

//Construct to create DB init resource
export class DBInitResource extends Construct {

  public readonly response: string;
  public readonly customResource: customResources.AwsCustomResource;
  public readonly function: lambda.Function

  constructor(scope: Construct, id: string, props: CdkResourceInitializerProps) {
    
    super(scope, id);
    const stack = cdk.Stack.of(this);

    const dbInitFn = new lambda.DockerImageFunction(this, 'rdsInitFunction', {
      memorySize: props.fnMemorySize || 256,
      functionName: `${id}RdsInit${stack.stackName}`,
      code: props.fnCode,
      vpcSubnets: props.vpc.selectSubnets(props.subnetsSelection),
      securityGroups:[ ...props.fnSecurityGroups ],
      timeout: props.fnTimeout,
      logRetention: props.fnLogRetention,
      environment: {
        DB_ENDPOINT_ADDRESS: props.endpoint,
        DB_NAME: props.databaseName,
        DB_SECRET_ARN: props.dbSecretArn
      }
    });

    const payload: string = JSON.stringify({
      params: {
        databaseName: props.databaseName,
        endpoint: props.endpoint,
        dbSecretArn: props.dbSecretArn
      }
    });

    const payloadHashPrefix = createHash('md5').update(payload).digest('hex').substring(0, 6);

    const sdkCall: customResources.AwsSdkCall = {
      service: 'Lambda',
      action: 'invoke',
      parameters: {
        FunctionName: dbInitFn.functionName,
        Payload: payload
      },
      physicalResourceId: customResources.PhysicalResourceId.of(`${id}-AwsSdkCall-${dbInitFn.currentVersion.version + payloadHashPrefix}`)
    };

    const customResourceFnRole = new iam.Role(this, 'rds-db-customresource-role', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com')
    })

    customResourceFnRole.addToPolicy(
      new iam.PolicyStatement({
        resources: [`arn:aws:lambda:${stack.region}:${stack.account}:function:*RdsInit${stack.stackName}`],
        actions: ['lambda:InvokeFunction']
      })
    );
    this.customResource = new customResources.AwsCustomResource(this, 'rdsInitCustomResource', {
      policy: customResources.AwsCustomResourcePolicy.fromSdkCalls({ resources: customResources.AwsCustomResourcePolicy.ANY_RESOURCE }),
      onUpdate: sdkCall,
      timeout: cdk.Duration.minutes(1),
      role: customResourceFnRole
    });

    this.response = this.customResource.getResponseField('Payload')
    this.function = dbInitFn
  }
}

export class RdsLambdaInitStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPC that shouldn't have internet access (DB, Proxy, Init lambda)
    const rdsInitVPpc = new ec2.Vpc(this, 'rdsInitVpc', {
      maxAzs: 2,
      vpcName: 'rdsInitVpc',
      subnetConfiguration: [{
        cidrMask: 24,
        name: 'privateLambda',
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED
      }],
      natGateways: 0
    });

    // Security group for the resources DB Resources
    const rdsInitSecurityGroup = new ec2.SecurityGroup(this, 'rdsInitSecurityGroup', {
      securityGroupName: 'rdsInitSecurityGroup',
      vpc: rdsInitVPpc
    });

    const rdsInitPgDbSecret = new rds.DatabaseSecret(this, 'rdsInitPgDbSecret', {
      username: 'postgres',
      secretName: 'rdsInitPgDbSecret'
    });

    // Postgres database instance creation
    const rdsInigPgDb = new rds.DatabaseInstance(this, 'rdsInigPgDb', {
      engine: rds.DatabaseInstanceEngine.postgres(
        { version: rds.PostgresEngineVersion.VER_15_2 }
      ),
      parameters: {
        'rds.force_ssl': '0',
      },
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE3,
        ec2.InstanceSize.SMALL
      ),
      vpc: rdsInitVPpc,
      vpcSubnets: rdsInitVPpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED
      }),
      multiAz: false,
      databaseName: 'rds_init_pg_db',
      securityGroups: [ rdsInitSecurityGroup ],
      //TODO: This must retrieve from the secrets manager group without using NAT
      credentials: rds.Credentials.fromSecret(rdsInitPgDbSecret),
      allocatedStorage: 15,
      maxAllocatedStorage: 20,
      backupRetention: cdk.Duration.days(1),
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // RDS proxy to keep connection pool
    const rdsInitPgDbProxy = new rds.DatabaseProxy(this, 'rdsInitPgDbProxy', {
      proxyTarget: rds.ProxyTarget.fromInstance(rdsInigPgDb),
      dbProxyName: 'rdsInitPgDbProxy',
      //TODO: This must retrieve from the secrets manager group without using NAT
      secrets: [ rdsInitPgDbSecret ],
      securityGroups: [ rdsInitSecurityGroup ],
      vpc: rdsInitVPpc,
      requireTLS: false,
      vpcSubnets: rdsInitVPpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED
      })
    });

    // DB proxy creation depends on the database creation
    rdsInitPgDbProxy.node.addDependency(rdsInigPgDb);

    // Lambda to startup DB structure


    
  }
}
