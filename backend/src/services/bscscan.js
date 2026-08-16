import axios from 'axios';
import { CONFIG } from '../config.js';

export async function checkBscWalletTransactions(walletAddress, expectedAmount){
  try{
    if(!CONFIG.BSCSCAN_API_KEY){
      return { error: 'Missing BSCSCAN_API_KEY', found: false };
    }
    const url = `https://api.bscscan.com/api?module=account&action=tokentx&contractaddress=${CONFIG.BSC_USDT_CONTRACT}&address=${walletAddress}&startblock=0&endblock=99999999&sort=desc&apikey=${CONFIG.BSCSCAN_API_KEY}`;
    const { data } = await axios.get(url, { timeout: 15000 });
    
    if(data.status !== '1' && typeof data.result === 'string'){
      return { found: false, transactions: [] };
    }
    const txs = data.result || [];
    const now = Date.now();
    const recentTxs = txs.filter(tx => {
      const txTime = parseInt(tx.timeStamp)*1000;
      return (now - txTime) < 2*60*60*1000; // 2h
    });

    for(let tx of recentTxs){
      const value = parseFloat(tx.value) / Math.pow(10, parseFloat(tx.tokenDecimal || 18));
      if(tx.to.toLowerCase() === walletAddress.toLowerCase()){
        const diff = Math.abs(value - expectedAmount);
        if(diff <= CONFIG.AUTO_CHECK_TOLERANCE){
          return {
            found: true,
            transaction: {
              hash: tx.hash,
              from: tx.from,
              to: tx.to,
              value,
              expectedAmount,
              timeStamp: tx.timeStamp,
              blockNumber: tx.blockNumber,
              tokenSymbol: tx.tokenSymbol
            },
            allRecent: recentTxs.slice(0,5)
          };
        }
      }
    }
    return { found: false, recentCount: recentTxs.length, checked: true };
  }catch(e){
    return { error: e.toString(), found: false };
  }
}
