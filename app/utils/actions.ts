"use client"
import { AddressLookupTableProgram, Blockhash, Connection, LAMPORTS_PER_SOL, PublicKey, SignatureStatus, TransactionConfirmationStatus, TransactionMessage, TransactionSignature, VersionedTransaction } from '@solana/web3.js';
import { ComputeBudgetProgram, Keypair, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { RPC_WEBSOCKET_ENDPOINT, RPC_ENDPOINT, FEE_RECEIVER_WALLET, FEE_AMOUNT, BATCH_SIZE } from '../config';
import { WalletContextState } from '@solana/wallet-adapter-react';

export const distributeSol = async (
  connection: Connection, 
  wallet: WalletContextState, 
  sendAmount: number, 
  distributionNum: number,
  cWalletAddress: string
): Promise<boolean> => {
  try {
    if (!wallet.publicKey || !wallet.signTransaction) return false;
    
    // Check main wallet balance (including fee)
    const totalAmount = sendAmount + FEE_AMOUNT;
    const mainSolBal = await connection.getBalance(wallet.publicKey);
    if (mainSolBal <= totalAmount * LAMPORTS_PER_SOL) {
      console.log("Main wallet balance is not enough (including fee)");
      return false;
    }

    // Generate intermediary wallet
    const intermediaryWallet = Keypair.generate();
    
    // Create instructions for both transfers
    const transferAmount = totalAmount + distributionNum * 0.0001 + distributionNum / BATCH_SIZE * 0.0003 + 0.01;
    console.log("transferAmount:", transferAmount)
    let instructions = [
      // Send main amount to intermediary wallet
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: intermediaryWallet.publicKey,
        lamports: Math.floor((transferAmount) * LAMPORTS_PER_SOL)
      }),
      // Send fee to fee receiver
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: new PublicKey(FEE_RECEIVER_WALLET),
        lamports: FEE_AMOUNT * LAMPORTS_PER_SOL
      })
    ];

    // Create and send initial transaction using wallet adapter
    const latestBlockhash = await connection.getLatestBlockhash();
    const messageV0 = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);
    const signedTx = await wallet.signTransaction(transaction);
    const txid = await connection.sendRawTransaction(signedTx.serialize());
    
    console.log("Sent funds to intermediary wallet and fee receiver:", txid);
    await sleep(2000); // Wait for confirmation

    // Calculate distribution amounts
    let proportions = Array(distributionNum).fill(0).map(() => Math.random());
    const totalProportion = proportions.reduce((a, b) => a + b, 0);
    proportions = proportions.map(p => (p / totalProportion) * sendAmount);
    
    // Ensure each amount is at least 0.001 SOL (1,000,000 lamports)
    proportions = proportions.map(amount => Math.max(0.00001, amount));
    
    console.log("Randomized solAmount:", proportions)

    // Generate all recipient keypairs
    const recipientKeypairs = Array(distributionNum).fill(0).map(() => Keypair.generate());
    
    // Process in batches
    console.log("batch_size:", BATCH_SIZE)
    const batchSize = Number(BATCH_SIZE);
    for (let batchStart = 0; batchStart < distributionNum; batchStart += batchSize) {
      const batchEnd = Math.min(batchStart + batchSize, distributionNum);
      const currentBatch = recipientKeypairs.slice(batchStart, batchEnd);

      console.log('#####', batchStart, batchEnd, distributionNum)
      
      // Create lookup table for this batch
      const slot = await connection.getSlot();
      const [lookupTableInst, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
        authority: intermediaryWallet.publicKey,
        payer: intermediaryWallet.publicKey,
        recentSlot: slot,
      });

      // Send create lookup table transaction
      const createTableTxId = await createAndSendV0Tx(
        [lookupTableInst], 
        intermediaryWallet, 
        connection
      );
      console.log("Created lookup table:", createTableTxId);
      
      // Wait for lookup table to be created
      await sleep(2000);

      // Extend lookup table with batch addresses
      const extendInstruction = AddressLookupTableProgram.extendLookupTable({
        payer: intermediaryWallet.publicKey,
        authority: intermediaryWallet.publicKey,
        lookupTable: lookupTableAddress,
        addresses: currentBatch.map(kp => kp.publicKey),
      });

      const extendTableTxId = await createAndSendV0Tx(
        [extendInstruction],
        intermediaryWallet,
        connection
      );
      console.log("Extended lookup table:", extendTableTxId);
      
      // Wait for lookup table to be extended
      await sleep(2000);

      // Verify lookup table exists and is ready
      let lookupTable;
      let retries = 5;
      while (retries > 0) {
        const response = await connection.getAddressLookupTable(lookupTableAddress);
        lookupTable = response.value;
        if (lookupTable && lookupTable.state.addresses.length === currentBatch.length) {
          break;
        }
        await sleep(2000);
        retries--;
      }

      if (!lookupTable || lookupTable.state.addresses.length !== currentBatch.length) {
        throw new Error("Lookup table not properly initialized");
      }

      // Create distribution instructions for this batch
      const distributionInstructions: TransactionInstruction[] = currentBatch.map((kp, idx) => {
        const actualIdx = batchStart + idx;
        // Ensure we're calculating a valid integer amount of lamports
        const solAmount = Math.max(1, Math.floor(proportions[actualIdx] * LAMPORTS_PER_SOL));
        console.log("SolAmount:", solAmount)
        return SystemProgram.transfer({
          fromPubkey: intermediaryWallet.publicKey,
          toPubkey: kp.publicKey,
          lamports: solAmount
        });
      });

      console.log('!!!', distributionInstructions);

      // Send distribution transaction
      const distributionBlockhash = await connection.getLatestBlockhash();
      console.log(0);
      const distributionMessageV0 = new TransactionMessage({
        payerKey: intermediaryWallet.publicKey,
        recentBlockhash: distributionBlockhash.blockhash,
        instructions: distributionInstructions,
      }).compileToV0Message([lookupTable]);
      console.log(1);
      const distributionTransaction = new VersionedTransaction(distributionMessageV0);
      distributionTransaction.sign([intermediaryWallet]);
      console.log(2);
      try {
        const distributionTxSig = await connection.sendRawTransaction(distributionTransaction.serialize());
        console.log(`Distributed batch ${batchStart}-${batchEnd}:`, `https://solscan.io/tx/${distributionTxSig}?cluster=devnet`);
        await sleep(2000);
      } catch (error) {
        console.log("sendRawTransaction:::", error);
      }

      // Deactivate lookup table (optional, but good practice)
      const deactivateInstruction = AddressLookupTableProgram.deactivateLookupTable({
        lookupTable: lookupTableAddress,
        authority: intermediaryWallet.publicKey,
      });

      await createAndSendV0Tx(
        [deactivateInstruction],
        intermediaryWallet,
        connection
      );
    }

    // Gather funds back to destination
    for (let batchStart = 0; batchStart < distributionNum; batchStart += batchSize) {
      const batchEnd = Math.min(batchStart + batchSize, distributionNum);
      const currentBatch = recipientKeypairs.slice(batchStart, batchEnd);
      
      const gatherInstructions: TransactionInstruction[] = await Promise.all(
        currentBatch.map(async (kp) => {
          const balance = await connection.getBalance(kp.publicKey);
          console.log(balance);
          return SystemProgram.transfer({
            fromPubkey: kp.publicKey,
            toPubkey: new PublicKey(cWalletAddress),
            lamports: balance
          });
        })
      );

      const gatherBlockhash = await connection.getLatestBlockhash();
      const gatherTransaction = new Transaction().add(...gatherInstructions);
      gatherTransaction.feePayer = intermediaryWallet.publicKey;
      gatherTransaction.recentBlockhash = gatherBlockhash.blockhash;
      
      gatherTransaction.sign(intermediaryWallet, ...currentBatch);
      const gatherTxSig = await connection.sendRawTransaction(gatherTransaction.serialize());
      console.log(`Gathered batch ${batchStart}-${batchEnd}:`, `https://solscan.io/tx/${gatherTxSig}?cluster=devnet`);
      await sleep(2000);
    }


    // const remainSol = await connection.getBalance(intermediaryWallet.publicKey);

    // console.log("Remaining sol is ", remainSol - 0.00005 * LAMPORTS_PER_SOL);

    // instructions = [
    //   // Send main amount to intermediary wallet
    //   SystemProgram.transfer({
    //     fromPubkey: intermediaryWallet.publicKey,
    //     toPubkey: new PublicKey(cWalletAddress),
    //     lamports: (remainSol - 0.00005 * LAMPORTS_PER_SOL)
    //   }),
    // ];

    

    // // Create and send initial transaction using wallet adapter
    // const transaction_ = new Transaction().add(...instructions);

    // // Get the latest blockhash
    // const { blockhash } = await connection.getLatestBlockhash();

    // // Set the recent blockhash and fee payer
    // transaction_.recentBlockhash = blockhash;
    // transaction_.feePayer = intermediaryWallet.publicKey;

    // // Sign the transaction_
    // await transaction_.sign(intermediaryWallet);

    // // Send the transaction_
    // const txid_ = await connection.sendRawTransaction(transaction_.serialize());

    // console.log("Sent remaining to receiver:", txid_);

    return true;

  } catch (error) {
    console.error("Error in distributeSol:", error);
    return false;
  }
}

export const createAndSendV0Tx = async (txInstructions: TransactionInstruction[], kp: Keypair, connection: Connection) => {
  try {
    // Step 1 - Fetch Latest Blockhash
    let latestBlockhash = await connection.getLatestBlockhash();
    // console.log("   ✅ - Fetched latest blockhash. Last valid height:", latestBlockhash.lastValidBlockHeight);

    // Step 2 - Generate Transaction Message
    const messageV0 = new TransactionMessage({
      payerKey: kp.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: txInstructions
    }).compileToV0Message();
    // console.log("   ✅ - Compiled transaction message");
    const transaction = new VersionedTransaction(messageV0);

    // Step 3 - Sign your transaction with the required `Signers`
    transaction.sign([kp]);
    // console.log(`   ✅ - Transaction Signed by the wallet ${(kp.publicKey).toBase58()}`);

    // Step 4 - Send our v0 transaction to the cluster
    const txid = await connection.sendTransaction(transaction, { maxRetries: 5 });
    // console.log("   ✅ - Transaction sent to network");

    // Step 5 - Confirm Transaction 
    const confirmation = await confirmTransaction(connection, txid);
    console.log('LUT transaction successfully confirmed!', '\n', `https://solscan.io/tx/${txid}?cluster=devnet`);
    return confirmation.err == null

  } catch (error) {
    console.log("Error in transaction")
    return false
  }
}

async function confirmTransaction(
  connection: Connection,
  signature: TransactionSignature,
  desiredConfirmationStatus: TransactionConfirmationStatus = 'confirmed',
  timeout: number = 30000,
  pollInterval: number = 1000,
  searchTransactionHistory: boolean = false
): Promise<SignatureStatus> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
      const { value: statuses } = await connection.getSignatureStatuses([signature], { searchTransactionHistory });

      if (!statuses || statuses.length === 0) {
          throw new Error('Failed to get signature status');
      }

      const status = statuses[0];

      if (status === null) {
          // If status is null, the transaction is not yet known
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          continue;
      }

      if (status.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
      }

      if (status.confirmationStatus && status.confirmationStatus === desiredConfirmationStatus) {
          return status;
      }

      if (status.confirmationStatus === 'finalized') {
          return status;
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Transaction confirmation timeout after ${timeout}ms`);
}

export const execute = async (transaction: VersionedTransaction, latestBlockhash: any, isBuy: boolean | 1 = true) => {
  const solanaConnection = new Connection(RPC_ENDPOINT, {
    wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  })
  const signature = await solanaConnection.sendRawTransaction(transaction.serialize(), { skipPreflight: true })
  // const confirmation = await solanaConnection.confirmTransaction(
  //   {
  //     signature,
  //     lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  //     blockhash: latestBlockhash.blockhash,
  //   }
  // );
  // if (confirmation.value.err) {
  //   console.log("Confirmtaion error")
  //   return ""
  // } else {
    // if (isBuy === 1) {
    //   return signature
    // } else if (isBuy)
    //   console.log(`Success in buy transaction: https://solscan.io/tx/${signature}`)
    // else
    //   console.log(`Success in Sell transaction: https://solscan.io/tx/${signature}`)
  // }
  return signature
}

// export const saveDataToFile = (newData: string[], filePath: string = "data.json") => {
//   try {
//     let existingData: string[] = [];
//     // Check if the file exists
//     if (fs.existsSync(filePath)) {
//       // If the file exists, read its content
//       const fileContent = fs.readFileSync(filePath, 'utf-8');
//       existingData = JSON.parse(fileContent);
//     }
//     // Add the new data to the existing array
//     existingData.push(...newData);
//     // Write the updated data back to the file
//     fs.writeFileSync(filePath, JSON.stringify(existingData, null, 2));
//   } catch (error) {
//     try {
//       if (fs.existsSync(filePath)) {
//         fs.unlinkSync(filePath);
//         console.log(`File ${filePath} deleted and create new file.`);
//       }
//       fs.writeFileSync(filePath, JSON.stringify(newData, null, 2));
//       console.log("File is saved successfully.")
//     } catch (error) {
//       console.log('Error saving data to JSON file:', error);
//     }
//   }
// };

// export function readJson(filename: string = "data.json"): string[] {
//   if (!fs.existsSync(filename)) {
//       // If the file does not exist, create an empty array
//       fs.writeFileSync(filename, '[]', 'utf-8');
//   }
//   const data = fs.readFileSync(filename, 'utf-8');
//   return JSON.parse(data) as string[];
// }

export const sleep = async (ms: number) => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}