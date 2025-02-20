import { Blockhash, Connection, LAMPORTS_PER_SOL, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { ComputeBudgetProgram, Keypair, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { RPC_WEBSOCKET_ENDPOINT, RPC_ENDPOINT, FEE_RECEIVER_WALLET, FEE_AMOUNT } from '../config';
import { WalletContextState } from '@solana/wallet-adapter-react';


export const distributeSol = async (
  connection: Connection, 
  wallet: WalletContextState, 
  sendAmount: any, 
  distritbutionNum: number,
  cWalletAddress: any
): Promise<Keypair[] | null> => {
  try {
    if(!wallet.publicKey) return null;
    const sendSolTxToMiddle: TransactionInstruction[] = []
    sendSolTxToMiddle.push(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 250_000 })
    )
    const sendSolTxToReceiver: TransactionInstruction[] = []
    sendSolTxToReceiver.push(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 250_000 })
    )
    const mainSolBal = await connection.getBalance(wallet.publicKey)
    if (mainSolBal <= sendAmount * 10 ** 6) {
      console.log("Main wallet balance is not enough")
      return []
    }
    let proportions = Array(distritbutionNum).fill(0).map(() => Math.random());
    const totalProportion = proportions.reduce((a, b) => a + b, 0);
    proportions = proportions.map(p => p / totalProportion);
    const kps: Keypair[] = [];
    for (let i = 0; i < distritbutionNum; i++) {
      const kp = Keypair.generate()
      kps.push(kp)
      const solAmount = Math.floor(sendAmount * proportions[i] * LAMPORTS_PER_SOL)
      sendSolTxToMiddle.push(
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: kp.publicKey,
          lamports: solAmount
        })
      )
    }
    sendSolTxToMiddle.push(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: new PublicKey(FEE_RECEIVER_WALLET),
        lamports: Math.floor(FEE_AMOUNT * LAMPORTS_PER_SOL)
      })
    )
    // for (let i = 0; i < distritbutionNum; i++) {
    //   // const kp = Keypair.generate()
    //   // kps.push(kp)
    //   const solAmount = Math.floor(sendAmount * proportions[i] * LAMPORTS_PER_SOL)
    //   // const solAmount = await connection.getBalance(kps[i].publicKey)

    //   sendSolTxToReceiver.push(
    //     SystemProgram.transfer({
    //       fromPubkey: kps[i].publicKey,
    //       toPubkey: new PublicKey(cWalletAddress),
    //       lamports: solAmount
    //     })
    //   )
    // }
    let index = 0
    while (true) {
      try {
        if (index > 5) {
          console.log("Error in distribution")
          return null;
        }
        const siTx = new Transaction().add(...sendSolTxToMiddle)
        const latestBlockhash = await connection.getLatestBlockhash()
        siTx.feePayer = wallet.publicKey
        siTx.recentBlockhash = latestBlockhash.blockhash
        const messageV0 = new TransactionMessage({
          payerKey: wallet.publicKey,
          recentBlockhash: latestBlockhash.blockhash,
          instructions: sendSolTxToMiddle,
        }).compileToV0Message()
        const transaction = new VersionedTransaction(messageV0)
        // transaction.sign([mainKp])
        console.log(index)
        // if(wallet.signTransaction)
        // await wallet.signTransaction!(transaction)
        console.log("@1");
        // console.log(await connection.simulateTransaction(transaction))
        // let txSig = await execute(transaction, latestBlockhash, 1)
        const txSig = await wallet.sendTransaction(transaction, connection);
        console.log("@2");
        if (txSig) {
          const distibuteTx = txSig ? `https://solscan.io/tx/${txSig}` : ''
          console.log("SOL distributed ", distibuteTx)
          // return kps;
          break;
        }
        index++
      } catch (error) {
        // index++
        return null;
      }
    }
    await sleep(5 * 1000)

    console.log("Sol gathering...");
    
    while (true) {
      try {
        if (index > 5) {
          console.log("Error in gather")
          return null;
        }
        // kps.map(async (kp) => {
        for (let i = 0; i < kps.length; i++) {
          const amount = await connection.getBalance(kps[i].publicKey)
          console.log("amount:", amount)
          sendSolTxToReceiver.push(
                SystemProgram.transfer({
                  fromPubkey: kps[i].publicKey,
                  toPubkey: new PublicKey(cWalletAddress),
                  lamports: amount
                })
              )
        }
        // })

        const siTx = new Transaction().add(...sendSolTxToReceiver)
        const latestBlockhash = await connection.getLatestBlockhash()
        siTx.feePayer = wallet.publicKey
        siTx.recentBlockhash = latestBlockhash.blockhash
        console.log(sendSolTxToReceiver)
          const messageV0 = new TransactionMessage({
            payerKey: wallet.publicKey,
            recentBlockhash: latestBlockhash.blockhash,
            instructions: sendSolTxToReceiver,
          }).compileToV0Message()
          const transaction = new VersionedTransaction(messageV0)
          transaction.sign(kps)
          console.log(index)
          // if(wallet.signTransaction)
          // await wallet.signTransaction!(transaction)
          console.log("@@1");
          // console.log(await connection.simulateTransaction(transaction))
          // let txSig = await execute(transaction, latestBlockhash, 1)
          console.log(await connection.simulateTransaction(transaction))

          const txSig = await wallet.sendTransaction(transaction, connection);
          // const txSig = await connection.sendRawTransaction(transaction.serialize());
          console.log("@@2");
          if (txSig) {
            const distibuteTx = txSig ? `https://solscan.io/tx/${txSig}` : ''
            console.log("SOL gathered: ", distibuteTx)
            return kps;
            // break;
          }
          index++
        console.log(3)
      } catch (error) {
        index++
        return null;
      }
    }
  } catch (error) {
    console.log(`Failed to transfer SOL`, error)
    return null
  }
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