#!/usr/bin/env node
import { Command } from 'commander';
import { accountAddCmd, accountListCmd, accountRemoveCmd } from './commands/account.js';
import { cloneAccountCmd } from './commands/clone-account.js';
import { cloneProgramCmd } from './commands/clone-program.js';
import { programAddCmd, programListCmd, programRemoveCmd } from './commands/program.js';
import {
  projectCreateCmd,
  projectDeleteCmd,
  projectListCmd,
  projectOpenCmd,
} from './commands/project.js';
import { runCmd } from './commands/run.js';
import {
  sessionCreateCmd,
  sessionDeleteCmd,
  sessionListCmd,
  sessionResetCmd,
} from './commands/session.js';
import { txHistoryCmd, txReplayCmd, txSendCmd } from './commands/tx.js';

const program = new Command();

program
  .name('reley')
  .description('Reley CLI - clone Solana programs/accounts, run in SVM sandbox, manage projects')
  .version('0.0.0');

// --- Raw clone / run ---
program
  .command('clone-program')
  .description('Clone a program ELF from RPC into an output directory (raw, no project state)')
  .argument('<programId>')
  .requiredOption('--rpc <url>', 'RPC endpoint URL')
  .requiredOption('--out <dir>', 'output directory')
  .option('--network <name>', 'network label', 'mainnet-beta')
  .option('--slot <slot>', 'pin to slot')
  .option('--cache <dir>', 'blob cache directory')
  .action(cloneProgramCmd);

program
  .command('clone-account')
  .description('Clone an account from RPC (raw, no project state)')
  .argument('<address>')
  .requiredOption('--rpc <url>', 'RPC endpoint URL')
  .requiredOption('--out <dir>', 'output directory')
  .option('--network <name>', 'network label', 'mainnet-beta')
  .option('--slot <slot>', 'pin to slot')
  .option('--cache <dir>', 'blob cache directory')
  .action(cloneAccountCmd);

program
  .command('run')
  .description('Load program ELFs and accounts into LiteSVM, send a raw instruction')
  .requiredOption('--program <spec>', 'programId:elfPath (repeatable)', collectRepeat, [])
  .option('--account <spec>', 'pubkey:blobPath (repeatable)', collectRepeat, [])
  .option('--payer <secretKeyPath>')
  .option('--ix <hex>', 'raw instruction data (hex); requires --ix-program')
  .option('--ix-program <pubkey>')
  .option('--ix-account <spec>', 'pubkey:isSigner:isWritable (repeatable)', collectRepeat, [])
  .option('--tx <base64>', 'serialized versioned transaction (skips --ix)')
  .option('--compute-units <n>')
  .action(runCmd);

// --- Project ---
const projectCmd = program.command('project').description('Manage projects');
projectCmd
  .command('create <name>')
  .description('Create a new project')
  .option('--description <text>')
  .option('--network <id>', 'mainnet-beta | devnet | testnet | custom', 'mainnet-beta')
  .requiredOption('--rpc <url-or-id>', 'RPC URL or endpoint id (URL used directly for now)')
  .action(projectCreateCmd);
projectCmd.command('list').description('List projects').action(projectListCmd);
projectCmd
  .command('open <id>')
  .description('Open a project (touch last-opened)')
  .action(projectOpenCmd);
projectCmd.command('delete <id>').description('Delete a project').action(projectDeleteCmd);

// --- Session ---
const sessionCmd = program.command('session').description('Manage sessions');
sessionCmd
  .command('create <name>')
  .description('Create a new session under a project')
  .requiredOption('--project <id>')
  .action(sessionCreateCmd);
sessionCmd
  .command('list')
  .description('List sessions')
  .option('--project <id>', 'filter by project')
  .action(sessionListCmd);
sessionCmd.command('delete <id>').description('Delete a session').action(sessionDeleteCmd);
sessionCmd.command('reset <id>').description('Reset session to baseline').action(sessionResetCmd);

// --- Program (project-scoped) ---
const programCmd = program.command('program').description('Manage programs inside a project');
programCmd
  .command('add <programId>')
  .description('Clone a program from RPC and add to project')
  .requiredOption('--project <id>')
  .option('--rpc-url <url>', 'override project RPC')
  .option('--slot <slot>')
  .action(programAddCmd);
programCmd
  .command('list')
  .description('List programs in a project')
  .requiredOption('--project <id>')
  .action(programListCmd);
programCmd
  .command('remove <programId>')
  .description('Remove a program from a project')
  .requiredOption('--project <id>')
  .action(programRemoveCmd);

// --- Account (project-scoped, grouped under program) ---
const accountCmd = program
  .command('account')
  .description('Manage PDAs / accounts grouped under programs');
accountCmd
  .command('add <address>')
  .description('Clone an account from RPC and group under a program')
  .requiredOption('--project <id>')
  .requiredOption('--program <programId>')
  .option('--label <text>')
  .option('--rpc-url <url>')
  .option('--slot <slot>')
  .action(accountAddCmd);
accountCmd
  .command('list')
  .description('List accounts')
  .requiredOption('--project <id>')
  .option('--program <programId>', 'filter by program')
  .action(accountListCmd);
accountCmd
  .command('remove <address>')
  .description('Remove account from project')
  .requiredOption('--project <id>')
  .action(accountRemoveCmd);

// --- Tx (session-scoped) ---
const txCmd = program.command('tx').description('Build and send transactions in a session');
txCmd
  .command('send')
  .description('Build a one-instruction tx, sign with auto-payer (or supplied), execute in SVM')
  .requiredOption('--session <id>')
  .requiredOption('--program <programId>')
  .requiredOption('--data <hex>', 'instruction data as hex')
  .option('--account <spec>', 'pubkey:isSigner:isWritable (repeatable)', collectRepeat, [])
  .option('--payer <keypairFile>', 'JSON keypair file')
  .option('--airdrop <lamports>', 'lamports to airdrop to payer first', '10000000000')
  .option('--compute-units <n>')
  .action(txSendCmd);
txCmd
  .command('history')
  .description('Show transaction history for a session')
  .requiredOption('--session <id>')
  .action(txHistoryCmd);
txCmd
  .command('replay <signature>')
  .description('Replay a mainnet tx locally (hydrates at slot-1, executes, diffs)')
  .option('--session <id>', 'session whose RPC + network to use')
  .option('--rpc-url <url>', 'override RPC URL (archive endpoint recommended)')
  .action(txReplayCmd);

program.parseAsync(process.argv).catch((err: unknown) => {
  if (err instanceof Error) {
    console.error(`error: ${err.message}`);
  } else {
    console.error('error:', err);
  }
  process.exit(1);
});

function collectRepeat(value: string, prev: string[]): string[] {
  return prev.concat([value]);
}
