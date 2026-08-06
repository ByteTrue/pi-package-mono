#!/usr/bin/env node
import { runImageGenCli } from '../../../dist/cli.js';

process.exitCode = await runImageGenCli();
