import { supabase } from '../supabase.js';
import { checkBscWalletTransactions } from './bscscan.js';
import { sendTelegramMessage } from './telegram.js';

export async function autoCheckDeposits(){
  try{
    const { data: busyWallets, error } = await supabase
      .from('deposit_wallets')
      .select('*')
      .eq('status','BUSY')
      .eq('network','BEP20')
      .limit(5);

    if(error) throw error;
    if(!busyWallets || busyWallets.length===0){
      return { success: true, checked: 0, approved: 0, message: 'Không có ví BUSY' };
    }

    let checked = 0;
    let approved = 0;
    let results = [];

    for(let wallet of busyWallets){
      if(!wallet.busy_by || !wallet.busy_amount) continue;
      checked++;
      const expectedAmount = parseFloat(wallet.busy_amount);
      const checkResult = await checkBscWalletTransactions(wallet.address, expectedAmount);

      // log
      await supabase.from('deposit_logs').insert({
        wallet_id: wallet.id,
        wallet_label: wallet.label,
        address: wallet.address,
        expected_amount: expectedAmount,
        busy_by: wallet.busy_by,
        busy_by_email: wallet.busy_by_email,
        check_result: checkResult
      });

      if(checkResult.found){
        // find pending investment matching wallet and amount
        const { data: invs } = await supabase
          .from('investments')
          .select('*')
          .eq('user_id', wallet.busy_by)
          .eq('status','PENDING')
          .eq('wallet_id', wallet.id);

        let pendingInv = null;
        if(invs){
          pendingInv = invs.find(i => Math.abs(parseFloat(i.amount)-expectedAmount) < 0.01) || invs[0];
        }

        if(pendingInv){
          // approve
          await supabase.from('investments').update({
            status: 'APPROVED',
            approved_at: new Date().toISOString(),
            auto_approved: true,
            tx_hash: checkResult.transaction.hash,
            tx_from: checkResult.transaction.from
          }).eq('id', pendingInv.id);

          // update user total_invested
          const { data: user } = await supabase.from('users').select('*').eq('id', wallet.busy_by).single();
          if(user){
            await supabase.from('users').update({
              total_invested: (parseFloat(user.total_invested)||0)+pendingInv.amount
            }).eq('id', user.id);

            await supabase.from('transactions').insert({
              user_id: user.id,
              type: 'INVEST',
              amount: pendingInv.amount,
              note: `Auto-approved $${expectedAmount} - Tx ${checkResult.transaction.hash}`
            });
          }

          // free wallet
          await supabase.from('deposit_wallets').update({
            status: 'AVAILABLE',
            busy_by: null,
            busy_by_email: null,
            busy_amount: null,
            assigned_at: null,
            total_received: (parseFloat(wallet.total_received)||0)+expectedAmount,
            last_used_at: new Date().toISOString()
          }).eq('id', wallet.id);

          // update log as approved
          await supabase.from('deposit_logs').insert({
            wallet_id: wallet.id,
            wallet_label: wallet.label,
            address: wallet.address,
            expected_amount: expectedAmount,
            busy_by: wallet.busy_by,
            busy_by_email: wallet.busy_by_email,
            auto_approved: true,
            tx_hash: checkResult.transaction.hash,
            check_result: checkResult
          });

          approved++;
          results.push({ wallet: wallet.label, user: wallet.busy_by_email, amount: expectedAmount, txHash: checkResult.transaction.hash });

          try{
            const msg = `🤖 <b>AUTO DUYỆT ĐẦU TƯ</b>\n\n👤 ${wallet.busy_by_email}\n💰 $${expectedAmount} USDT\n🏦 ${wallet.label} - ${wallet.network}\n🔗 ${checkResult.transaction.hash}\n⏰ ${new Date().toLocaleString('vi-VN')}`;
            await sendTelegramMessage(msg);
          }catch(e){}
        }
      }
    }

    return { success: true, checked, approved, results, message: `Đã kiểm tra ${checked} ví, duyệt ${approved}` };
  }catch(e){
    console.error('autoCheck error', e);
    return { success: false, error: e.toString() };
  }
}
