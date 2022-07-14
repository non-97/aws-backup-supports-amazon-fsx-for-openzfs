#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { OpenzfsStack } from "../lib/openzfs-stack";

const app = new cdk.App();
new OpenzfsStack(app, "OpenzfsStack");
