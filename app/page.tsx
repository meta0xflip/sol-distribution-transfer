// app/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { Inter } from 'next/font/google';
import Image from 'next/image';
import { FEE_AMOUNT, RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT } from './config';
import { distributeSol } from './utils/actions'

const inter = Inter({ subsets: ['latin'] });

const commitment = "confirmed"

// const connection = new Connection(RPC_ENDPOINT, {
//   wsEndpoint: RPC_WEBSOCKET_ENDPOINT, commitment
// })

export default function Home() {
  const { publicKey, connected } = useWallet();
  const { connection } = useConnection();
  const wallet = useWallet();
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [sendAmount, setSendAmount] = useState<number>(0);
  const [bWalletCount, setBWalletCount] = useState<number>(0);
  const [cWalletAddress, setCWalletAddress] = useState<string>('');
  const [isValidCAddress, setIsValidCAddress] = useState<boolean>(false);
  const [fee, setFee] = useState<any>(0);

  // Calculate estimated fee (this is a placeholder calculation)
  useEffect(() => {
    if (bWalletCount && sendAmount) {
      // Simplified fee calculation: 0.000005 SOL per transaction × (bWalletCount × 2)
      // Each B wallet requires 2 transactions (A→B and B→C)
      const calculatedFee: number = 0.000005 * (bWalletCount * 2) + Number(FEE_AMOUNT);
      setFee(calculatedFee);
    }
  }, [bWalletCount, sendAmount]);

  // Fetch wallet balance
  useEffect(() => {
    if (publicKey) {
      const fetchBalance = async () => {
        try {
          const balance = await connection.getBalance(publicKey);
          setSolBalance(balance / LAMPORTS_PER_SOL);
        } catch (error) {
          console.error('Error fetching balance:', error);
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

  const executeTransfer = async () => {
    if (!wallet) return;
    // console.log("Wallet Info:", wallet);
    await distributeSol(connection, wallet, sendAmount, bWalletCount, cWalletAddress)
  }

  // Handle form submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Implementation for transaction would go here
    // alert(`Ready to process: ${sendAmount} SOL to be distributed through ${bWalletCount} B wallets to wallet ${cWalletAddress}`);
    executeTransfer();
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-8 bg-gray-900 text-gray-100">
      <div className="w-full max-w-2xl bg-gray-800 rounded-xl shadow-lg p-8">
        <div className="flex flex-col items-center mb-8">
          <h1 className="text-3xl font-bold mb-4 text-purple-400">Solana Distribution Transfer</h1>
          <Image src="/solana-logo.svg" alt="Solana Logo" width={80} height={80} className="mb-4" />
          <div className="mb-6">
            <WalletMultiButton className="bg-purple-600 hover:bg-purple-700 rounded-lg py-2 px-4" />
          </div>
        </div>

        {connected && publicKey ? (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="bg-gray-700 rounded-lg p-4 mb-6">
              <h2 className="text-xl font-semibold mb-2 text-purple-300">Sender wallet Info</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-400">Address:</p>
                  <p className="font-mono text-sm truncate">{publicKey.toString()}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-400">Balance:</p>
                  <p className="font-mono font-semibold">{solBalance !== null ? `${solBalance.toFixed(4)} SOL` : 'Loading...'}</p>
                </div>
              </div>
            </div>
            
            <div className="space-y-4">
              <div>
                <label htmlFor="sendAmount" className="block text-sm font-medium text-gray-300 mb-1">
                  Amount to Send (SOL)
                </label>
                <input
                  id="sendAmount"
                  type="number"
                  min="0.1"
                  step="0.1"
                  className="w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  value={sendAmount}
                  onChange={(e) => setSendAmount(parseFloat(e.target.value))}
                  required
                />
              </div>
              
              <div>
                <label htmlFor="bWalletCount" className="block text-sm font-medium text-gray-300 mb-1">
                  Middle Wallet Count (100-1000)
                </label>
                <input
                  id="bWalletCount"
                  type="number"
                  min="1"
                  max="1000"
                  className="w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  value={bWalletCount}
                  onChange={(e) => setBWalletCount(parseInt(e.target.value))}
                  required
                />
                <p className="mt-2 text-sm text-yellow-400">
                  <span className="inline-flex items-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Funds will be randomized across Middle wallets (e.g., 0.5 SOL for first, 0.2 SOL for second, etc.)
                  </span>
                </p>
              </div>
              
              <div>
                <label htmlFor="cWalletAddress" className="block text-sm font-medium text-gray-300 mb-1">
                  Receiver Wallet Address
                </label>
                <input
                  id="cWalletAddress"
                  type="text"
                  className={`w-full bg-gray-700 border ${isValidCAddress ? 'border-green-500' : 'border-gray-600'} rounded-md py-2 px-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono`}
                  value={cWalletAddress}
                  onChange={(e) => setCWalletAddress(e.target.value)}
                  placeholder="Enter destination wallet address"
                  required
                />
                {cWalletAddress && !isValidCAddress && (
                  <p className="mt-1 text-sm text-red-400">Please enter a valid Solana address</p>
                )}
              </div>
            </div>
            
            <div className="bg-gray-700 rounded-lg p-4 my-6">
              <div className="flex justify-between items-center">
                <span className="text-gray-300">Estimated Network Fee:</span>
                <span className="font-mono font-semibold text-green-400">{fee.toFixed(6)} SOL</span>
              </div>
              <div className="flex justify-between items-center mt-2">
                <span className="text-gray-300">Total Amount (with fee):</span>
                <span className="font-mono font-semibold text-green-400">{(sendAmount + fee).toFixed(6)} SOL</span>
              </div>
            </div>
            
            <div className="text-center">
              <button 
                type="submit" 
                className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-500 disabled:cursor-not-allowed cursor-pointer text-white font-bold py-3 px-6 rounded-lg w-full transition duration-200 flex items-center justify-center"
                disabled={!connected || !isValidCAddress || !sendAmount || !bWalletCount || (solBalance !== null && sendAmount > solBalance)}
              >
                {connected ? 'Execute Transfer' : 'Connect Wallet First'}
              </button>
              
              {solBalance !== null && sendAmount > solBalance && (
                <p className="mt-2 text-sm text-red-400">Insufficient balance</p>
              )}
            </div>
          </form>
        ) : (
          <div className="text-center p-8 bg-gray-700 rounded-lg">
            <p className="text-lg mb-4">Connect your wallet to start the transfer process</p>
            <p className="text-sm text-gray-400 mb-6">You'll need to connect your Solana wallet to proceed with the distribution.</p>
          </div>
        )}
        
        <div className="mt-8 text-center text-sm text-gray-500">
          <p>This interface distributes SOL from sender wallet to receiver wallet through multiple middle wallets.</p>
        </div>
      </div>
    </main>
  );
}