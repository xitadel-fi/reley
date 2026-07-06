/**
 * Mint mainnet USDC into a fresh wallet against a Reley-hosted LiteSVM session.
 *
 * Env:
 *   RELEY_SESSION_URL       e.g. http://127.0.0.1:8899/session/<sessionId>
 *   PAYER_KEYPAIR           base58 secret OR path to Solana CLI JSON keypair
 *   MINT_AUTHORITY_KEYPAIR  base58 secret OR path; pubkey patched onto USDC.mintAuthority
 *   RECIPIENT_PUBKEY        base58 pubkey to receive USDC
 *   AMOUNT_USDC             integer number of whole USDC (will * 10^6)
 *   USDC_MINT               override mint (default = real mainnet USDC)
 */
import { existsSync, readFileSync } from 'node:fs';
import { Connection, Keypair, PublicKey, Transaction, ComputeBudgetProgram } from '@solana/web3.js';
import bs58 from 'bs58';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';

const USDC_MINT_DEFAULT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env: ${name}`);
  return v;
}

/**
 * Accept either:
 *   - base58 string (64-byte secret key)
 *   - filesystem path to Solana-CLI JSON array
 * Heuristic: if it starts with `[` or points at an existing file, treat as JSON.
 */
function loadKeypair(value: string): Keypair {
  const trimmed = value.trim();
  // JSON array literal
  if (trimmed.startsWith('[')) {
    const raw = JSON.parse(trimmed) as number[];
    return Keypair.fromSecretKey(new Uint8Array(raw));
  }
  // Path on disk
  if (existsSync(trimmed)) {
    const raw = JSON.parse(readFileSync(trimmed, 'utf8')) as number[];
    return Keypair.fromSecretKey(new Uint8Array(raw));
  }
  // Otherwise: base58
  const bytes = bs58.decode(trimmed);
  if (bytes.length !== 64) {
    throw new Error(`expected 64-byte secret; got ${bytes.length} bytes from base58 decode`);
  }
  return Keypair.fromSecretKey(bytes);
}

async function main(): Promise<void> {
  const url = envOrThrow('RELEY_SESSION_URL');
  const payer = loadKeypair(envOrThrow('PAYER_KEYPAIR'));
  const mintAuthority = loadKeypair(envOrThrow('MINT_AUTHORITY_KEYPAIR'));
  const recipient = new PublicKey(envOrThrow('RECIPIENT_PUBKEY'));
  const wholeAmount = BigInt(envOrThrow('AMOUNT_USDC'));
  const mint = new PublicKey(process.env.USDC_MINT ?? USDC_MINT_DEFAULT);

  const conn = new Connection(url, 'confirmed');

  const ata = getAssociatedTokenAddressSync(mint, recipient, true);

  console.log(`session: ${url}`);
  console.log(`payer:           ${payer.publicKey.toBase58()}`);
  console.log(`mint-authority:  ${mintAuthority.publicKey.toBase58()}`);
  console.log(`recipient:       ${recipient.toBase58()}`);
  console.log(`ata:             ${ata.toBase58()}`);
  console.log(`mint:            ${mint.toBase58()}`);

  const readUsdcBalance = async (account: PublicKey): Promise<string> => {
    try {
      const info = await conn.getAccountInfo(account, 'confirmed');
      if (!info || info.data.length < 72) return '0';
      const raw = info.data.readBigUInt64LE(64);
      return (Number(raw) / 1_000_000).toString();
    } catch {
      return '0';
    }
  };

  const before = await readUsdcBalance(ata);
  console.log(`balance before:  ${before} USDC`);

  // USDC has 6 decimals
  const rawAmount = wholeAmount * 1_000_0n;

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey, // payer
      ata,             // associatedToken
      recipient,       // owner
      mint,            // mint
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
  );
  tx.add(
    createMintToInstruction(
      mint,                    // mint
      ata,                     // destination
      mintAuthority.publicKey, // authority
      rawAmount,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );

  const { blockhash } = await conn.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer.publicKey;
  tx.sign(payer, mintAuthority);

  const sig = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });
  console.log(`tx signature:    ${sig}`);

  const after = await readUsdcBalance(ata);
  console.log(`balance after:   ${after} USDC`);
  console.log('done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
