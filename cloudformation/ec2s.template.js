'use strict';

const cf = require('@mapbox/cloudfriend');

const Parameters = {
  GithubAccessToken: { Type: 'String', Description: '[secure] Github token with repo scope' }
};

const Resources = {
  Build: {
    Type: 'AWS::CodeBuild::Project',
    Properties: {
      Name: cf.stackName,
      Description: 'Run updates to https://rclark.github.io/ec2s',
      Artifacts: { Type: 'NO_ARTIFACTS' },
      Environment: {
        ComputeType: 'BUILD_GENERAL1_SMALL',
        EnvironmentVariables: [
          {
            Name: 'GITHUB_ACCESS_TOKEN',
            Value: cf.ref('GithubAccessToken')
          }
        ],
        Image: 'aws/codebuild/nodejs:6.3.1',
        Type: 'LINUX_CONTAINER'
      },
      ServiceRole: cf.getAtt('BuildRole', 'Arn'),
      Source: {
        Type: 'GITHUB',
        Location: 'https://github.com/rclark/ec2s'
      }
    }
  },
  Trigger: {
    Type: 'AWS::Lambda::Function',
    Properties: {
      FunctionName: cf.stackName,
      Description: 'Schedules updates to https://rclark.github.io/ec2s',
      Role: cf.getAtt('TriggerRole', 'Arn'),
      Code: {
        ZipFile: cf.join('\n', [
          'const AWS = require("aws-sdk");',
          'module.exports.lambda = (event, context, callback) => {',
          '  const codebuild = new AWS.CodeBuild();',
          '  codebuild.startBuild({',
          '    projectName: process.env.PROJECT_NAME,',
          '    sourceVersion: "gh-pages"',
          '  }).promise()',
          '    .then(() => callback())',
          '    .catch((err) => callback(err));',
          '};'
        ])
      },
      Handler: 'index.lambda',
      Runtime: 'nodejs6.10',
      Timeout: 30,
      MemorySize: 128,
      Environment: {
        Variables: {
          PROJECT_NAME: cf.ref('Build')
        }
      }
    }
  },
  Schedule: {
    Type: 'AWS::Events::Rule',
    Properties: {
      Description: 'Scheduled builds for https://rclark.github.io/ec2s',
      Name: cf.stackName,
      ScheduleExpression: 'rate(7 days)',
      Targets: [{ Arn: cf.getAtt('Trigger', 'Arn'), Id: 'Trigger' }],
      State: 'ENABLED'
    }
  },
  BuildRole: {
    Type: 'AWS::IAM::Role',
    Properties: {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Effect: 'Allow',
            Principal: { Service: 'codebuild.amazonaws.com' },
            Action: 'sts:AssumeRole'
          }
        ]
      },
      Policies: [
        {
          PolicyName: 'build-ec2s',
          PolicyDocument: {
            Statement: [
              {
                Effect: 'Allow',
                Action: [
                  'logs:CreateLogGroup',
                  'logs:CreateLogStream',
                  'logs:PutLogEvents'
                ],
                Resource: cf.sub('arn:aws:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/codebuild/*')
              },
              {
                Effect: 'Allow',
                Action: [
                  'ecr:GetDownloadUrlForLayer',
                  'ecr:BatchGetImage',
                  'ecr:BatchCheckLayerAvailability',
                  'ec2:DescribeSpotPriceHistory'
                ],
                Resource: '*'
              },
              {
                Effect: 'Allow',
                Action: 'kms:Decrypt',
                Resource: cf.importValue('cloudformation-kms-production')
              }
            ]
          }
        }
      ]
    }
  },
  TriggerRole: {
    Type: 'AWS::IAM::Role',
    Properties: {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Effect: 'Allow',
            Principal: { Service: 'lambda.amazonaws.com' },
            Action: 'sts:AssumeRole'
          }
        ]
      },
      Policies: [
        {
          PolicyName: 'build-trigger',
          PolicyDocument: {
            Statement: [
              {
                Effect: 'Allow',
                Action: 'logs:*',
                Resource: cf.getAtt('TriggerLogs', 'Arn')
              },
              {
                Effect: 'Allow',
                Action: 'codebuild:StartBuild',
                Resource: '*'
              }
            ]
          }
        }
      ]
    }
  },
  SchedulePermission: {
    Type: 'AWS::Lambda::Permission',
    Properties: {
      Action: 'lambda:InvokeFunction',
      Principal: 'events.amazonaws.com',
      FunctionName: cf.getAtt('Trigger', 'Arn'),
      SourceArn: cf.getAtt('Schedule', 'Arn')
    }
  },
  TriggerLogs: {
    Type: 'AWS::Logs::LogGroup',
    Properties: {
      LogGroupName: cf.sub('/aws/lambda/${AWS::StackName}'),
      RetentionInDays: 14
    }
  }
};

module.exports = cf.merge({ Parameters, Resources });
