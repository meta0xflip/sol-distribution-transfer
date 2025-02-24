"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Copy, ExternalLink } from "lucide-react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import Image from "next/image";
import { distributeSol } from "./utils/actions";
import { AddressLookupTableProgram, Blockhash, Connection, LAMPORTS_PER_SOL, PublicKey, SignatureStatus, TransactionConfirmationStatus, TransactionMessage, TransactionSignature, VersionedTransaction } from '@solana/web3.js';
import { ComputeBudgetProgram, Keypair, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { RPC_WEBSOCKET_ENDPOINT, RPC_ENDPOINT, FEE_RECEIVER_WALLET, FEE_AMOUNT, BATCH_SIZE } from '@/app/config';
import { WalletContextState } from '@solana/wallet-adapter-react';
import { disconnect } from "process";

export default function Home() {
  const { publicKey, connected } = useWallet();
  const { connection } = useConnection();
  const wallet = useWallet();
  const [solBalance, setSolBalance] = useState<any>(0);
  const [walletCount, setWalletCount] = useState(14); // initial B wallet count
  const [amount, setAmount] = useState(""); // amount to send in sol
  const [showValidation, setShowValidation] = useState(false); // show confirming modal
  const [cWalletAddress, setCWalletAddress] = useState<string>('7qC6qDxoYkLhE4CPfoskE1XtcayjUcGo5s1Kzoy5Bokt'); // receiver wallet
  const networkFee = (FEE_AMOUNT + Number(amount) + walletCount * 0.0001 + walletCount / BATCH_SIZE * 0.0003 + 0.01).toFixed(6);
  const [isValidCAddress, setIsValidCAddress] = useState<boolean>(false);
  const minWalletCount = 1; // min B wallet count
  const maxWalletCount = 100; // max B wallet count
  const [disCount, setDisCount] = useState(0); // distributing B Count
  const [gatCount, setGatCount] = useState(0); // gathering C count
  const [isTxSuccess, setIsTxSuccess] = useState<boolean>(false); // is all gathered
  const txHash = `https://solscan.io/account/${cWalletAddress}?cluster=devnet`;

  // Fetch wallet balance
  useEffect(() => {
    if (publicKey) {
      const fetchBalance = async () => {
        try {
          const balance = await connection.getBalance(publicKey);
          const balanceToSet = (balance / LAMPORTS_PER_SOL).toFixed(4);
          setSolBalance(balanceToSet);
        } catch (error) {
          console.error("Error fetching balance:", error);
          setSolBalance(null);
        }
      };

      fetchBalance();
      // Set up interval to refresh balance
      const intervalId = setInterval(fetchBalance, 15000);

      return () => clearInterval(intervalId);
    }
  }, [publicKey, connected]);

  // Validate C wallet address
  useEffect(() => {
    try {
      if (cWalletAddress.length > 0) {
        new PublicKey(cWalletAddress);
        setIsValidCAddress(true);
      } else {
        setIsValidCAddress(false);
      }
    } catch (error) {
      setIsValidCAddress(false);
    }
  }, [cWalletAddress]);

  // initialize
  const executeTransfer = async () => {
    if (!wallet) return;
    // console.log("Wallet Info:", wallet);
    setShowValidation(true)
    await distributeSol(connection, wallet, Number(amount), walletCount, cWalletAddress)
  }


  /*********************************/
  const distributeSol = async (
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
      setDisCount(0);
      setGatCount(0);
      setIsTxSuccess(false);
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
          setDisCount(batchEnd)
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

      await sleep(5000);
  
      // Gather funds back to destination
      for (let batchStart = 0; batchStart < distributionNum; batchStart += batchSize) {
        const batchEnd = Math.min(batchStart + batchSize, distributionNum);
        const currentBatch = recipientKeypairs.slice(batchStart, batchEnd);
        
        const gatherInstructions: TransactionInstruction[] = await Promise.all(
          currentBatch.map(async (kp) => {
            const balance = await connection.getBalance(kp.publicKey);
            console.log("Balances of ", kp.publicKey, "is ", balance);
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
        setGatCount(batchEnd);
        await sleep(2000);
      }

      setIsTxSuccess(true);
  
  
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
  
  const createAndSendV0Tx = async (txInstructions: TransactionInstruction[], kp: Keypair, connection: Connection) => {
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
  
  const execute = async (transaction: VersionedTransaction, latestBlockhash: any, isBuy: boolean | 1 = true) => {
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

  const sleep = async (ms: number) => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  }
  /*********************************/

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="px-8 py-6 border-b border-white/[0.02]">
        <div className="flex justify-between items-center max-w-[1400px] mx-auto">
          <span className="text-lg tracking-tight">Distribution</span>
          <div className="flex items-center gap-6">
            {connected && (
              <span className="text-zinc-600">{solBalance} SOL</span>
            )}
            {/* <button
              onClick={() => setIsWalletConnected(!isWalletConnected)}
              className="bg-zinc-900 px-5 py-2 rounded hover:bg-zinc-800 transition-colors"
            >
              {isWalletConnected ? "Disconnect" : "Connect Wallet"}
            </button> */}
            <WalletMultiButton>
              {!connected ? "Connect Wallet" : ''}
            </WalletMultiButton>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-[1400px] mx-auto px-8 py-12">
        <div className="grid grid-cols-[45%,1fr] gap-24">
          {/* Left Column */}
          <div className="space-y-16">
            {/* Amount Input */}
            <div>
              <span className="text-xs text-zinc-600 uppercase tracking-wider block mb-3">
                Distribution Amount
              </span>
              <div className="relative">
                <input
                  type="text"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.0"
                  className="w-full bg-transparent text-lg pb-3 border-b border-zinc-800 
                           focus:border-white outline-none transition-colors"
                />
                <span className="absolute right-0 bottom-3 text-zinc-600">
                  SOL
                </span>
              </div>
            </div>
            {/* Intermediate Wallets */}
            <div>
              <span className="text-xs text-zinc-600 uppercase tracking-wider block mb-6">
                Intermediate Wallets
              </span>
              <div>
                <div className="flex justify-between items-baseline mb-6">
                  <span className="text-4xl font-light">{walletCount}</span>
                  <div className="flex gap-6">
                    <button
                      onClick={() => setWalletCount(minWalletCount)}
                      className="text-sm text-zinc-600 hover:text-white transition-colors"
                    >
                      Min {minWalletCount}
                    </button>
                    <button
                      onClick={() => setWalletCount(maxWalletCount)}
                      className="text-sm text-zinc-600 hover:text-white transition-colors"
                    >
                      Max {maxWalletCount}
                    </button>
                  </div>
                </div>
                <div className="relative h-[2px] group">
                  <div className="absolute inset-0 bg-zinc-800" />
                  <motion.div
                    className="absolute inset-y-0 left-0 bg-white group-hover:bg-blue-400 transition-colors"
                    style={{ width: `${((walletCount - minWalletCount) / (maxWalletCount - minWalletCount)) * 100}%` }}
                  />
                  <input
                    type="range"
                    min={minWalletCount}
                    max={maxWalletCount}
                    value={walletCount}
                    onChange={(e) => setWalletCount(Number(e.target.value))}
                    className="absolute w-full h-6 -top-2 opacity-0 cursor-pointer"
                  />
                </div>
              </div>
            </div>

            {/* Destination Input */}
            <div>
              <span className="text-xs text-zinc-600 uppercase tracking-wider block mb-3">
                Destination
              </span>
              <input
                type="text"
                value={cWalletAddress}
                onChange={(e) => setCWalletAddress(String(e.target.value))}
                placeholder="Enter destination address"
                className="w-full bg-transparent text-lg pb-3 border-b border-zinc-800 
                         focus:border-white outline-none transition-colors"
              />
            </div>

            {/* Fee Summary */}
            <div className="space-y-4">
              <div className="flex justify-between py-3 border-b border-zinc-900">
                <span className="text-zinc-600">
                  Network Fee ({walletCount} txns)
                </span>
                <span>{networkFee} SOL</span>
              </div>
              <div className="flex justify-between py-3">
                <span>Total</span>
                <span className="text-lg">{networkFee} SOL</span>
              </div>
            </div>

            <button
              onClick={executeTransfer}
              className="w-full bg-white text-black py-4 rounded-lg hover:bg-zinc-100 
                       transition-colors text-sm tracking-wide disabled:bg-gray-500 disabled:cursor-not-allowed"
              disabled={!connected || !isValidCAddress || Number(amount) == 0 || !walletCount || (solBalance !== null && Number(amount) > solBalance)}
            >
              Initialize
            </button>
            {solBalance !== null && Number(amount) > solBalance && (
                <p className="mt-2 text-sm text-red-400">Insufficient balance</p>
              )}
          </div>
          {/* Right Side - Process Visualization */}
          <div className="space-y-8">
            {/* Top Flow Diagram */}
            <div className="rounded-xl border border-zinc-800/50 p-6 bg-zinc-900/20">
              <div className="relative">
                <div className="absolute top-1/2 left-0 right-0 -translate-y-1/2">
                  <div className="absolute left-0 right-0 h-[1px] bg-zinc-800" />
                </div>
                <div className="relative flex justify-between">
                  {["A", "B", "C"].map((node) => (
                    <motion.div
                      key={node}
                      className="flex flex-col items-center"
                      whileHover={{ scale: 1.05 }}
                    >
                      <div
                        className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-800 
                                   flex items-center justify-center"
                      >
                        {node}
                      </div>
                      <span className="text-sm text-zinc-500 mt-2">
                        {node === "A"
                          ? "Source"
                          : node === "B"
                          ? walletCount
                          : "Destination"}
                      </span>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>

            {/* Detailed Process Visualization */}
            <div className="rounded-xl border border-zinc-800/50 p-6 bg-zinc-900/20">
              <div className="relative h-[400px]">
                {/* Source Wallet (Left) */}
                <div className="absolute left-0 top-1/2 -translate-y-1/2">
                  <motion.div
                    className="w-16 h-16 rounded-full bg-zinc-900 border border-zinc-800 
                             flex items-center justify-center"
                    whileHover={{ scale: 1.1 }}
                  >
                    A
                  </motion.div>
                </div>

                {/* B Wallets (Middle) */}
                <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-[200px]">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <motion.div
                      key={i}
                      className="absolute w-10 h-10 rounded-full bg-zinc-900 border border-zinc-800 
                                 flex items-center justify-center"
                      style={{
                        top: `${(i / 10) * 100}%`,
                        left: `${Math.sin(i * 0.8) * 50 + 50}%`,
                        transform: "translate(-50%, -50%)",
                      }}
                      whileHover={{ scale: 1.1 }}
                    >
                      B
                    </motion.div>
                  ))}
                </div>

                {/* Destination Wallet (Right) */}
                <div className="absolute right-0 top-1/2 -translate-y-1/2">
                  <motion.div
                    className="w-16 h-16 rounded-full bg-zinc-900 border border-zinc-800 
                             flex items-center justify-center"
                    whileHover={{ scale: 1.1 }}
                  >
                    C
                  </motion.div>
                </div>
                {/* Animated Transaction Paths */}
                <svg
                  className="absolute inset-0"
                  style={{ pointerEvents: "none" }}
                >
                  {Array.from({ length: 6 }).map((_, i) => (
                    <g key={i}>
                      {/* Path from A to B */}
                      <motion.circle
                        r="2"
                        fill="#60A5FA"
                        initial={{ pathOffset: 0 }}
                        animate={{
                          cx: [50, 200 + Math.sin(i * 0.8) * 100],
                          cy: [200, (i / 7) * 400],
                        }}
                        transition={{
                          duration: 2,
                          delay: i * 0.2,
                          repeat: Infinity,
                        }}
                      />
                      {/* Path from B to C */}
                      <motion.circle
                        r="2"
                        fill="#60A5FA"
                        initial={{ pathOffset: 0 }}
                        animate={{
                          cx: [200 + Math.sin(i * 0.8) * 100, 350],
                          cy: [(i / 7) * 400, 200],
                        }}
                        transition={{
                          duration: 2,
                          delay: i * 0.2 + 1,
                          repeat: Infinity,
                        }}
                      />
                    </g>
                  ))}
                </svg>

                {/* Process Steps */}
                <div className="absolute inset-x-0 bottom-0 space-y-4 pt-6">
                  <motion.div
                    className="text-sm text-zinc-500"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.5 }}
                  >
                    1. Source sends total amount
                  </motion.div>
                  <motion.div
                    className="text-sm text-zinc-500"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 1.5 }}
                  >
                    2. Amount split between {walletCount} intermediate wallets
                  </motion.div>
                  <motion.div
                    className="text-sm text-zinc-500"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 2.5 }}
                  >
                    3. Each B wallet forwards to destination
                  </motion.div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Combined Transaction Modal */}
      <AnimatePresence>
        {showValidation && (
          <motion.div
            className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="bg-[#141519] rounded-2xl w-full max-w-2xl"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
            >
              <div className="p-8">
                <div className="flex justify-between items-center mb-8">
                  <h2 className="text-xl">
                    Send Tokens to Initialize Distribution
                  </h2>
                  <button
                    onClick={() => setShowValidation(false)}
                    className="text-zinc-500 hover:text-white"
                  >
                    <X size={20} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-8">
                  {/* Left Column - QR and Address */}
                  <div>
                    {/* <div className="bg-white rounded-lg p-4 mb-4">
                      <img
                        src="/api/placeholder/200/200"
                        alt="QR Code"
                        className="w-full"
                      />
                    </div> */}

                    <span className="text-xs text-zinc-600 uppercase tracking-wider block mb-3">
                      Source wallet
                    </span>
                    <div className="bg-zinc-900/50 rounded-lg p-4 flex items-center justify-between mb-4">
                      <code className="text-sm flex-1 truncate mr-2">
                        {publicKey?.toString()}
                      </code>
                      <button className="text-zinc-500 hover:text-white">
                        <Copy size={16} />
                      </button>
                    </div>
                    <span className="text-xs text-zinc-600 uppercase tracking-wider block mb-3">
                      Destination wallet
                    </span>
                    <div className="bg-zinc-900/50 rounded-lg p-4 flex items-center justify-between mb-4">
                      <code className="text-sm flex-1 truncate mr-2">
                        {cWalletAddress}
                      </code>
                      <button className="text-zinc-500 hover:text-white">
                        <Copy size={16} />
                      </button>
                    </div>

                    <div className="space-y-4">
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Amount</span>
                        <span>{amount} SOL</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Wallets</span>
                        <span>{walletCount}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Network Fee</span>
                        <span>{networkFee} SOL</span>
                      </div>
                    </div>
                  </div>

                  {/* Right Column - Progress (ABC Visualization + Steps) */}
                  <div>
                    {/* Wallet Flow Visualization */}
                    <div className="mb-8">
                      <div className="relative">
                        {/* Connection Lines */}
                        <div className="absolute top-1/2 left-12 right-12 -translate-y-1/2">
                          {/* Line A to B */}
                          <div className="absolute left-0 right-1/2 h-[1px] bg-zinc-800">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <motion.div
                                key={`ab-${i}`}
                                className="absolute top-1/2 h-1 w-1 bg-white rounded-full"
                                initial={{ left: "0%", opacity: 0 }}
                                animate={{
                                  left: "100%",
                                  opacity: [0, 1, 0],
                                }}
                                transition={{
                                  duration: 2,
                                  delay: i * 0.4,
                                  repeat: Infinity,
                                  ease: "linear",
                                }}
                              />
                            ))}
                          </div>

                          {/* Line B to C */}
                          <div className="absolute left-1/2 right-0 h-[1px] bg-zinc-800">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <motion.div
                                key={`bc-${i}`}
                                className="absolute top-1/2 h-1 w-1 bg-white rounded-full"
                                initial={{ left: "0%", opacity: 0 }}
                                animate={{
                                  left: "100%",
                                  opacity: [0, 1, 0],
                                }}
                                transition={{
                                  duration: 2,
                                  delay: i * 0.4 + 1, // Delayed start after A->B
                                  repeat: Infinity,
                                  ease: "linear",
                                }}
                              />
                            ))}
                          </div>
                        </div>

                        {/* Wallet Nodes */}
                        <div className="relative flex justify-between items-center px-12">
                          {[
                            { label: "A", text: "Source" },
                            { label: "B", text: walletCount },
                            { label: "C", text: "Destination" },
                          ].map((node, index) => (
                            <div
                              key={node.label}
                              className="flex flex-col items-center"
                            >
                              <motion.div
                                className="w-12 h-12 rounded-full border border-zinc-800 
                                          flex items-center justify-center mb-2 bg-[#141519]"
                                animate={{
                                  scale: index === 1 ? [1, 1.1, 1] : 1,
                                  borderColor:
                                    index === 1
                                      ? [
                                          "rgb(39,39,42)",
                                          "rgb(255,255,255)",
                                          "rgb(39,39,42)",
                                        ]
                                      : "rgb(39,39,42)",
                                }}
                                transition={{
                                  duration: 2,
                                  repeat: Infinity,
                                }}
                              >
                                {node.label}
                              </motion.div>
                              <span className="text-sm text-zinc-500">
                                {node.text}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Progress Steps */}
                    <div className="space-y-4 mb-8">
                      <div className="flex justify-between items-center">
                        <span className="text-zinc-500">
                          Distributing B Wallets
                        </span>
                        <div className="flex items-center gap-2">
                          <motion.div
                            className="w-1.5 h-1.5 rounded-full bg-emerald-500"
                            animate={{ scale: [1, 1.5, 1] }}
                            transition={{ duration: 1, repeat: Infinity }}
                          />
                          <span>
                            {disCount} / {walletCount}
                          </span>
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-zinc-500">
                          Gathering to C Wallets
                        </span>
                        <div className="flex items-center gap-2">
                          <motion.div
                            className="w-1.5 h-1.5 rounded-full bg-emerald-500"
                            animate={{ scale: [1, 1.5, 1] }}
                            transition={{ duration: 1, repeat: Infinity }}
                          />
                          <span>{gatCount} / {walletCount}</span>
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-zinc-500">
                          Forwarding to C Wallet
                        </span>
                        <span>{isTxSuccess ? 'Confirmed' : 'pending'}</span>
                      </div>
                    </div>

                    {/* Time Stats */}
                    {/* <div className="grid grid-cols-2 gap-4 mb-6">
                      <div>
                        <span className="text-zinc-500 text-sm">
                          Time Elapsed
                        </span>
                        <div className="text-lg">03:45</div>
                      </div>
                      <div>
                        <span className="text-zinc-500 text-sm">
                          Est. Time Remaining
                        </span>
                        <div className="text-lg">12:30</div>
                      </div>
                    </div> */}
                    <div className="flex items-center justify-between text-sm">
                      <button className="text-zinc-500 hover:text-white flex items-center gap-2">
                        <ExternalLink size={16} />
                        <a href={txHash}>View on Explorer</a>
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t border-zinc-800">
                  <p className="text-sm text-zinc-500">
                    Send exactly {amount} SOL to this address to initiate the
                    distribution. After sending, you can track the progress in
                    real-time. The process will create {walletCount}{" "}
                    intermediate wallets for enhanced privacy.
                  </p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
