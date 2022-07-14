import {
  Stack,
  StackProps,
  aws_iam as iam,
  aws_ec2 as ec2,
  aws_secretsmanager as secretsmanager,
  aws_fsx as fsx,
} from "aws-cdk-lib";
import { Construct } from "constructs";

export class OpenzfsStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // SSM IAM Role
    const ssmIamRole = new iam.Role(this, "SSM IAM Role", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonSSMManagedInstanceCore"
        ),
      ],
    });

    // VPC
    const vpc = new ec2.Vpc(this, "Provider VPC", {
      cidr: "10.10.0.0/24",
      enableDnsHostnames: true,
      enableDnsSupport: true,
      natGateways: 0,
      maxAzs: 2,
      subnetConfiguration: [
        { name: "Public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 28 },
        {
          name: "Isolated",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 28,
        },
      ],
    });

    // Security Group used by FSx for OpenZFS file system
    const fileSystemSecurityGroup = new ec2.SecurityGroup(
      this,
      "Security Group of FSx for OpenZFS file system",
      {
        vpc,
      }
    );
    fileSystemSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(111),
      "Remote procedure call for NFS"
    );
    fileSystemSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(2049),
      "NFS server daemon"
    );
    fileSystemSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcpRange(20001, 20003),
      "NFS mount, status monitor, and lock daemon"
    );
    fileSystemSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.udp(111),
      "Remote procedure call for NFS"
    );
    fileSystemSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.udp(2049),
      "NFS server daemon"
    );
    fileSystemSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.udpRange(20001, 20003),
      "NFS mount, status monitor, and lock daemon"
    );

    // EC2 Instance
    new ec2.Instance(this, "Consumer EC2 Instance", {
      instanceType: new ec2.InstanceType("t3.micro"),
      machineImage: ec2.MachineImage.latestAmazonLinux({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),
      vpc,
      blockDevices: [
        {
          deviceName: "/dev/xvda",
          volume: ec2.BlockDeviceVolume.ebs(8, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
          }),
        },
      ],
      propagateTagsToVolumeOnCreation: true,
      vpcSubnets: vpc.selectSubnets({
        subnetType: ec2.SubnetType.PUBLIC,
      }),
      role: ssmIamRole,
    });

    // FSx for OpenZFS
    new fsx.CfnFileSystem(this, "FSx for OpenZFS", {
      fileSystemType: "OPENZFS",
      subnetIds: [
        vpc.selectSubnets({
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        }).subnetIds[0],
      ],
      openZfsConfiguration: {
        deploymentType: "SINGLE_AZ_1",
        automaticBackupRetentionDays: 31,
        copyTagsToBackups: true,
        copyTagsToVolumes: true,
        dailyAutomaticBackupStartTime: "16:00",
        diskIopsConfiguration: {
          mode: "AUTOMATIC",
        },
        options: ["DELETE_CHILD_VOLUMES_AND_SNAPSHOTS"],
        rootVolumeConfiguration: {
          copyTagsToSnapshots: true,
          dataCompressionType: "ZSTD",
          nfsExports: [
            {
              clientConfigurations: [
                {
                  clients: "*",
                  options: ["rw", "crossmnt"],
                },
              ],
            },
          ],
          readOnly: false,
          recordSizeKiB: 128,
          userAndGroupQuotas: [
            {
              id: 1,
              storageCapacityQuotaGiB: 2,
              type: "USER",
            },
          ],
        },
        throughputCapacity: 64,
        weeklyMaintenanceStartTime: "6:17:00",
      },
      securityGroupIds: [fileSystemSecurityGroup.securityGroupId],
      storageCapacity: 64,
      storageType: "SSD",
      tags: [
        {
          key: "Name",
          value: "fsx-for-openzfs",
        },
      ],
    });
  }
}
