import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Construct } from 'constructs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

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

    
  }
}
